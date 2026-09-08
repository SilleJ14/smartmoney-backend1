import fs from "fs";
import path from "path";
import readline from "readline";

const DATE_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

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
    const body = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
    fs.writeFileSync(temporary, body, "utf8");
    fs.renameSync(temporary, target);
    return { dateKey, rowCount: rows.length, bytesWritten: Buffer.byteLength(body), ...prune() };
  }

  async function readRecentHistories({ days = 30, maxSymbols = 5000 } = {}) {
    const selectedFiles = files().slice(-Math.max(1, Math.min(days, maxHistoryDays)));
    const histories = new Map();
    let rowsRead = 0;
    for (const name of selectedFiles) {
      const stream = fs.createReadStream(path.join(directory, name), { encoding: "utf8" });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line) continue;
        const row = JSON.parse(line);
        if (!row.s) continue;
        if (!histories.has(row.s) && histories.size >= maxSymbols) continue;
        if (!histories.has(row.s)) histories.set(row.s, []);
        histories.get(row.s).push(row);
        rowsRead += 1;
      }
    }
    return { histories, rowsRead, filesRead: selectedFiles.length };
  }

  return { writeDaily, readRecentHistories, prune, stats };
}
