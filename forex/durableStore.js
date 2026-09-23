import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
    candidates: [],
    dailyLoss: {},
    incidentLocks: {},
    peakEquity: {},
    dayStart: {},
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
      const next = clone(ledger);
      const result = await mutator(next);
      ledger = next;
      return result;
    },
  };
}

export function createFileStore({ filePath } = {}) {
  const resolved = path.resolve(filePath || path.join(process.cwd(), "data", "forex-ledger.json"));
  let available = true;

  function read() {
    try {
      if (!fs.existsSync(resolved)) return emptyLedger();
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
    fs.writeFileSync(tmp, JSON.stringify(ledger), "utf8");
    fs.renameSync(tmp, resolved);
  }

  try {
    write(read());
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
      return available;
    },
    async load() {
      if (!available) throw Object.assign(new Error("DURABLE_STORAGE_UNAVAILABLE"), { reason: "DURABLE_STORAGE_UNAVAILABLE" });
      return read();
    },
    async commit(mutator) {
      if (!available) throw Object.assign(new Error("DURABLE_STORAGE_UNAVAILABLE"), { reason: "DURABLE_STORAGE_UNAVAILABLE" });
      const next = read();
      const result = await mutator(next);
      write(next);
      return result;
    },
  };
}

export function createForexStore(options = {}) {
  if (options.store) return options.store;
  if (options.memory) return createMemoryStore(options);
  const filePath = options.filePath || process.env.FOREX_LEDGER_PATH;
  if (filePath || options.useFile) {
    return createFileStore({ filePath: filePath || path.join(os.tmpdir(), "smartmoney-forex-ledger.json") });
  }
  return createMemoryStore({ treatAsDurable: false });
}

export function txKey(accountId, transactionId) {
  return `${accountId}:${transactionId}`;
}
