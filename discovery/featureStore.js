import fs from "fs";
import path from "path";
import readline from "readline";

const DATE_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 2048;
const MAX_SYMBOLS = 5000;

function compactStoredRow(row, day) {
  if (!row || typeof row.s !== "string" || !/^[A-Z0-9.^/-]{1,32}$/.test(row.s) || row.d !== day) return null;
  const { o, h, l, c, v } = row;
  if (![o, h, l, c, v].every((n) => typeof n === "number" && Number.isFinite(n)) ||
    Math.min(o, h, l, c) <= 0 || v < 0 || h < Math.max(o, c, l) || l > Math.min(o, c, h)) return null;
  return { s: row.s, d: day, o, h, l, c, v };
}

function parseStoredLine(line, day) {
  if (!line || Buffer.byteLength(line) > MAX_LINE_BYTES) return null;
  try { return compactStoredRow(JSON.parse(line), day); } catch { return null; }
}

export function createDiscoveryFeatureStore({ directory, maxHistoryDays = 120, maxDiskBytes = 150 * 1024 * 1024 } = {}) {
  if (!directory) throw new Error("Discovery feature-store directory is required");

  function ensureDirectory() {
    fs.mkdirSync(directory, { recursive: true });
  }

  function files() {
    ensureDirectory();
    return fs.readdirSync(directory).filter((name) => DATE_FILE.test(name)).sort();
  }

  function stats() {
    const names = files();
    const bytes = names.reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0);
    return { directory, fileCount: names.length, bytes, megabytes: Number((bytes / 1024 / 1024).toFixed(2)), oldestDate: names[0]?.slice(0, 10) || null, newestDate: names.at(-1)?.slice(0, 10) || null, maxHistoryDays, maxDiskBytes };
  }

  function prune() {
    let names = files();
    const removed = [];
    while (names.length > maxHistoryDays) {
      const name = names.shift();
      fs.unlinkSync(path.join(directory, name));
      removed.push(name);
    }
    let current = stats();
    names = files();
    while (current.bytes > maxDiskBytes && names.length > 1) {
      const name = names.shift();
      fs.unlinkSync(path.join(directory, name));
      removed.push(name);
      current = stats();
    }
    return { removed, ...current };
  }

  function writeDaily(dateKey, rows = []) {
    ensureDirectory();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("Invalid discovery date key");
    const target = path.join(directory, `${dateKey}.jsonl`);
    const temporary = `${target}.${process.pid}.tmp`;
    const unique = new Map();
    for (const row of rows) {
      const compact = compactStoredRow(row, dateKey);
      if (compact && (unique.has(compact.s) || unique.size < MAX_SYMBOLS)) unique.set(compact.s, compact);
    }
    const storedRows = [...unique.values()];
    const body = storedRows.map((row) => JSON.stringify(row)).join("\n") + (storedRows.length ? "\n" : "");
    if (Buffer.byteLength(body) > Math.min(MAX_FILE_BYTES, maxDiskBytes)) throw new Error("Discovery daily store byte budget exceeded");
    fs.writeFileSync(temporary, body, "utf8");
    fs.renameSync(temporary, target);
    return { dateKey, rowCount: storedRows.length, bytesWritten: Buffer.byteLength(body), ...prune() };
  }

  function mergeDaily(dateKey, rows = []) {
    ensureDirectory();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("Invalid discovery date key");
    const target = path.join(directory, `${dateKey}.jsonl`);
    const existing = fs.existsSync(target) && fs.statSync(target).size <= MAX_FILE_BYTES
      ? fs.readFileSync(target, "utf8").split("\n").map((line) => parseStoredLine(line, dateKey)).filter(Boolean)
      : [];
    const incomingSymbols = new Set();
    const bySymbol = new Map(existing.map((row) => [row.s, row]));
    for (const row of rows) {
      const compact = compactStoredRow(row, dateKey);
      if (!compact) continue;
      incomingSymbols.add(compact.s);
      bySymbol.set(compact.s, compact);
    }
    let merged = [...bySymbol.values()];
    if (merged.length > MAX_SYMBOLS) {
      merged.sort((a, b) => {
        const aPriority = incomingSymbols.has(a.s) ? 1 : 0;
        const bPriority = incomingSymbols.has(b.s) ? 1 : 0;
        if (aPriority !== bPriority) return bPriority - aPriority;
        return (b.c * b.v) - (a.c * a.v) || a.s.localeCompare(b.s);
      });
      merged = merged.slice(0, MAX_SYMBOLS);
    }
    return writeDaily(dateKey, merged);
  }

  async function readRecentHistories({ days = 30, maxSymbols = 5000, prioritySymbols = [] } = {}) {
    maxSymbols = Math.max(1, Math.min(MAX_SYMBOLS, Number(maxSymbols) || MAX_SYMBOLS));
    const priority = new Set((Array.isArray(prioritySymbols) ? prioritySymbols : []).map((symbol) => String(symbol || "").toUpperCase()).filter(Boolean));
    const selectedFiles = files().slice(-Math.max(1, Math.min(days, maxHistoryDays)));
    const histories = new Map();
    let rowsRead = 0;
    let filesRead = 0;
    let skippedFiles = 0;
    let bytesRead = 0;
    function admit(symbol) {
      if (histories.has(symbol)) return true;
      if (histories.size < maxSymbols) {
        histories.set(symbol, []);
        return true;
      }
      if (!priority.has(symbol)) return false;
      const evict = [...histories.keys()].find((name) => !priority.has(name));
      if (!evict) return false;
      histories.delete(evict);
      histories.set(symbol, []);
      return true;
    }
    for (const name of selectedFiles.reverse()) {
      const bytes = fs.statSync(path.join(directory, name)).size;
      if (bytes > MAX_FILE_BYTES || bytesRead + bytes > maxDiskBytes) { skippedFiles++; continue; }
      bytesRead += bytes;
      filesRead++;
      const seen = new Set();
      const stream = fs.createReadStream(path.join(directory, name), { encoding: "utf8" });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line) continue;
        const row = parseStoredLine(line, name.slice(0, 10));
        if (!row || seen.has(row.s)) continue;
        seen.add(row.s);
        if (!admit(row.s)) continue;
        histories.get(row.s).push(row);
        rowsRead += 1;
      }
    }
    for (const history of histories.values()) history.sort((a, b) => String(a.d).localeCompare(String(b.d)));
    return { histories, rowsRead, filesRead, skippedFiles, bytesRead };
  }

  function seedHistories(histories = [], beforeDay) {
    const byDay = new Map();
    for (const history of histories.slice(0, 40)) for (const row of history.slice(-30)) {
      if (!DATE_FILE.test(`${row.d}.jsonl`) || row.d >= beforeDay) continue;
      if (!byDay.has(row.d)) byDay.set(row.d, []);
      byDay.get(row.d).push(row);
    }
    for (const [day, rows] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
      const target = path.join(directory, `${day}.jsonl`);
      const existing = fs.existsSync(target) && fs.statSync(target).size <= MAX_FILE_BYTES
        ? fs.readFileSync(target, "utf8").split("\n").map((line) => parseStoredLine(line, day)).filter(Boolean) : [];
      // Previously recorded daily rows win over a bootstrap response.
      const bySymbol = new Map([...rows, ...existing].map((row) => [row.s, row]));
      writeDaily(day, [...bySymbol.values()]);
    }
  }

  return { writeDaily, mergeDaily, readRecentHistories, seedHistories, prune, stats };
}
