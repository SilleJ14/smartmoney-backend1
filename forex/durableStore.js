import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { withExclusiveSqliteLock } from "./sqliteLock.js";

const queues = new Map();
const DEFAULT_STALE_LOCK_MS = 2 * 60 * 1000;

function lockAgeMs(lockPath, owner, now) {
  const acquiredAt = Date.parse(String(owner?.acquiredAt || ""));
  if (Number.isFinite(acquiredAt)) return Math.max(0, now - acquiredAt);
  try { return Math.max(0, now - fs.statSync(lockPath).mtimeMs); }
  catch { return Infinity; }
}

export function reclaimableForexLock({
  lockPath,
  owner,
  now = Date.now(),
  hostname = os.hostname(),
  staleLockMs = DEFAULT_STALE_LOCK_MS,
  processAlive = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== "ESRCH"; }
  },
} = {}) {
  const ageMs = lockAgeMs(lockPath, owner, now);
  if (owner?.host === hostname && Number.isInteger(owner?.pid) && owner.pid > 0) {
    // Our own PID means a previous incarnation with a reused PID (PID 1 after a
    // container restart): commits within this process are already serialized.
    if (owner.pid === process.pid) return true;
    // No commit legitimately takes this long, so an unrelated process that
    // reused the PID cannot hold the ledger hostage forever.
    return !processAlive(owner.pid) || ageMs >= staleLockMs * 10;
  }
  return ageMs >= staleLockMs;
}

export function compactForexLedger(ledger, archive) {
  const trim = (key, limit) => {
    if (ledger[key].length <= limit) return;
    const removed = ledger[key].slice(0, -limit);
    archive({ type: key, rows: removed }); // Durable archive BEFORE removal; failure aborts commit.
    ledger[key] = ledger[key].slice(-limit);
    if (key === "fills") ledger.archivedFillCount = (ledger.archivedFillCount || 0) + removed.filter(f => f.action === "CLOSED").length;
  };
  trim("audits", 100); trim("protection", 100); trim("unexplained", 100);
  const closed = new Set(ledger.fills.filter(f => f.action === "CLOSED").map(f => `${f.accountId}:${f.brokerTradeId}`));
  const open = new Set(ledger.openTradeIds || []);
  if (ledger.intents.length > 1000) {
    const removable = ledger.intents.filter(i => ["REJECTED", "CANCELLED", "FILLED"].includes(i.state)
      && (i.state !== "FILLED" || (closed.has(`${i.accountId}:${i.brokerTradeId}`) && !open.has(`${i.accountId}:${i.brokerTradeId}`))))
      .slice(0, ledger.intents.length - 1000);
    if (removable.length) {
      archive({ type: "intents", rows: removable });
      const ids = new Set(removable.map(i => i.intentId));
      ledger.intents = ledger.intents.filter(i => !ids.has(i.intentId));
      const reservations = ledger.reservations.filter(r => ids.has(r.intentId) && r.state !== "RESERVED");
      if (reservations.length) archive({ type: "reservations", rows: reservations });
      ledger.reservations = ledger.reservations.filter(r => !ids.has(r.intentId) || r.state === "RESERVED");
    }
  }
  if (ledger.fills.length > 2000) {
    const removable = ledger.fills.filter(f => closed.has(`${f.accountId}:${f.brokerTradeId}`) && !open.has(`${f.accountId}:${f.brokerTradeId}`)).slice(0, ledger.fills.length - 2000);
    if (removable.length) {
      archive({ type: "fills", rows: removable });
      const removedRows = new Set(removable);
      ledger.fills = ledger.fills.filter(f => !removedRows.has(f));
      ledger.archivedFillCount = (ledger.archivedFillCount || 0) + removable.filter(f => f.action === "CLOSED").length;
    }
  }
  // Never discard unresolved safety state to make room.
  if (ledger.intents.length > 10000 || ledger.fills.length > 20000) throw new Error("FOREX_LEDGER_MAINTENANCE_REQUIRED");
  for (const [account, seen] of Object.entries(ledger.seenTransactions)) {
    const cursor = BigInt(ledger.lastTransactionId[account] || 0);
    const ids = Object.keys(seen).sort((a,b) => Number(BigInt(a)-BigInt(b)));
    for (const id of ids.slice(0, -2000)) if (BigInt(id) <= cursor) {
      ledger.prunedSeenThrough ||= {};
      ledger.prunedSeenThrough[account] = id;
      delete seen[id];
    }
  }
}

export function emptyLedger() {
  return {
    version: 1,
    owner: null,
    lastTransactionId: {},
    seenTransactions: {},
    intents: [],
    reservations: [],
    fills: [],
    protection: [],
    management: {},
    candidates: [],
    strategyRegistry: null,
    dailyLoss: {},
    weeklyLoss: {},
    incidentLocks: {},
    peakEquity: {},
    dayStart: {},
    weekStart: {},
    unexplained: [],
    audits: [],
    pauseEntries: {},
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createMemoryStore({ treatAsDurable = false } = {}) {
  let ledger = emptyLedger();
  let available = true;
  let tail = Promise.resolve();
  return {
    kind: treatAsDurable ? "durable-memory" : "memory",
    get available() {
      return available;
    },
    setAvailable(next) {
      available = next === true;
    },
    isDurable() {
      return treatAsDurable && available;
    },
    async load() {
      if (!available) throw Object.assign(new Error("DURABLE_STORAGE_UNAVAILABLE"), { reason: "DURABLE_STORAGE_UNAVAILABLE" });
      return clone(ledger);
    },
    async commit(mutator) {
      if (!available) throw Object.assign(new Error("DURABLE_STORAGE_UNAVAILABLE"), { reason: "DURABLE_STORAGE_UNAVAILABLE" });
      const task = tail.then(async () => {
        const next = clone(ledger);
        const result = await mutator(next);
        ledger = next;
        return result;
      });
      tail = task.catch(() => {});
      return task;
    },
  };
}

export function createFileStore({
  filePath,
  persistentRoot,
  staleLockMs = DEFAULT_STALE_LOCK_MS,
  now = Date.now,
} = {}) {
  const resolved = path.resolve(filePath || path.join(process.cwd(), "data", "forex-ledger.json"));
  let available = true;

  function read() {
    try {
      if (!fs.existsSync(resolved)) return emptyLedger();
      if (fs.statSync(resolved).size > 16 * 1024 * 1024) throw new Error("FOREX_LEDGER_MAINTENANCE_REQUIRED");
      return { ...emptyLedger(), ...JSON.parse(fs.readFileSync(resolved, "utf8")) };
    } catch {
      available = false;
      throw Object.assign(new Error("DURABLE_STORAGE_UNAVAILABLE"), { reason: "DURABLE_STORAGE_UNAVAILABLE" });
    }
  }

  function write(ledger) {
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${resolved}.${process.pid}.tmp`;
    const body = JSON.stringify(ledger);
    if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error("FOREX_LEDGER_MAINTENANCE_REQUIRED");
    const fd = fs.openSync(tmp, "w");
    try { fs.writeFileSync(fd, body, "utf8"); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, resolved);
    if (process.platform !== "win32") {
      const directory = fs.openSync(dir, "r");
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  }

  try {
    if (!fs.existsSync(resolved)) write(emptyLedger());
    else read();
  } catch {
    available = false;
  }

  return {
    kind: "file",
    path: resolved,
    get available() {
      return available;
    },
    isDurable() {
      if (!available || !persistentRoot) return false;
      try {
        const relative = path.relative(fs.realpathSync(persistentRoot), fs.realpathSync(resolved));
        return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      } catch {
        return false;
      }
    },
    async load() {
      if (!available) throw Object.assign(new Error("DURABLE_STORAGE_UNAVAILABLE"), { reason: "DURABLE_STORAGE_UNAVAILABLE" });
      return read();
    },
    async commit(mutator) {
      if (!available) throw Object.assign(new Error("DURABLE_STORAGE_UNAVAILABLE"), { reason: "DURABLE_STORAGE_UNAVAILABLE" });
      const task = (queues.get(resolved) || Promise.resolve()).then(() => withExclusiveSqliteLock(`${resolved}.lock.db`, async () => {
        // The SQLite lock is the real mutual exclusion between processes. The
        // legacy .lock file is still honoured for an older build that may run
        // during a deploy, and still written so that build honours ours.
        const lockPath = `${resolved}.lock`;
        let lock;
        try { lock = fs.openSync(lockPath, "wx"); }
        catch {
          try {
            let owner = null;
            try { owner = JSON.parse(fs.readFileSync(lockPath, "utf8")); }
            catch { /* an interrupted lock write is reclaimable only after its lease expires */ }
            // A guarded lock file can only be left by a process that crashed:
            // we hold the SQLite lock, so no live guarded owner can exist.
            if (owner?.guardedBy !== "sqlite" && !reclaimableForexLock({ lockPath, owner, now: now(), staleLockMs })) {
              throw new Error("ACTIVE_OWNER");
            }
            // Safe without a race: every guarded process reclaims only while
            // holding the SQLite lock.
            fs.unlinkSync(lockPath);
            lock = fs.openSync(lockPath, "wx");
          } catch { throw new Error("FOREX_LEDGER_LOCKED"); }
        }
        try {
          fs.writeFileSync(lock, JSON.stringify({
            pid: process.pid,
            host: os.hostname(),
            acquiredAt: new Date(now()).toISOString(),
            guardedBy: "sqlite",
          }));
          fs.fsyncSync(lock);
          const next = read();
          const result = await mutator(next);
          compactForexLedger(next, record => {
            const archiveDir = `${resolved}.archive`;
            fs.mkdirSync(archiveDir, { recursive: true });
            // Each immutable segment is small; historical records stay on disk, not in RAM.
            const archivePath = path.join(archiveDir, `${Date.now()}-${process.pid}-${record.type}-${next.archiveSequence = (next.archiveSequence || 0) + 1}.json`);
            const fd = fs.openSync(archivePath, "wx");
            try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); }
            finally { fs.closeSync(fd); }
            if (process.platform !== "win32") {
              const directory = fs.openSync(archiveDir, "r");
              try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
            }
          });
          write(next);
          return result;
        } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
      }));
      const tail = task.catch(() => {});
      queues.set(resolved, tail);
      try { return await task; }
      finally { if (queues.get(resolved) === tail) queues.delete(resolved); }
    },
  };
}

export function createForexStore(options = {}) {
  if (options.store) return options.store;
  if (options.memory) return createMemoryStore(options);
  const filePath = options.filePath || process.env.FOREX_LEDGER_PATH;
  if (filePath || options.useFile) {
    return createFileStore({
      filePath: filePath || path.join(os.tmpdir(), "smartmoney-forex-ledger.json"),
      persistentRoot: options.persistentRoot || process.env.FOREX_PERSISTENT_ROOT,
      staleLockMs: options.staleLockMs,
      now: options.now,
    });
  }
  return createMemoryStore({ treatAsDurable: false });
}

export function txKey(accountId, transactionId) {
  return `${accountId}:${transactionId}`;
}
