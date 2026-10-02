import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const JOURNAL_VERSION = 1;
export const JOURNAL_EVENT_TYPES = Object.freeze([
  "PROVIDER_OBSERVATION", "EVIDENCE_SNAPSHOT", "DECISION", "INTENT",
  "FILL", "MANAGEMENT", "OUTCOME",
]);
const TYPES = new Set(JOURNAL_EVENT_TYPES);
const queues = new Map();

function blank() {
  return { version: JOURNAL_VERSION, sequence: 0, events: [], indexes: { recent: [], byType: {} } };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function createJournalEvent(type, payload, {
  timestamp = new Date().toISOString(),
  eventId = randomUUID(),
  sequence,
} = {}) {
  if (!TYPES.has(type)) throw new Error("FOREX_JOURNAL_EVENT_TYPE_INVALID");
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("FOREX_JOURNAL_TIMESTAMP_INVALID");
  if (!eventId || typeof eventId !== "string") throw new Error("FOREX_JOURNAL_EVENT_ID_INVALID");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("FOREX_JOURNAL_PAYLOAD_INVALID");
  return freeze(clone({ version: JOURNAL_VERSION, eventId, sequence, type, timestamp, payload }));
}

export function createJournalStore({
  filePath = path.join(process.cwd(), "data", "forex-journal.json"),
  maxIndexEntries = 1000,
  maxFileBytes = 64 * 1024 * 1024,
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
} = {}) {
  const resolved = path.resolve(filePath);

  function read() {
    if (!fs.existsSync(resolved)) return blank();
    if (fs.statSync(resolved).size > maxFileBytes) throw new Error("FOREX_JOURNAL_MAINTENANCE_REQUIRED");
    const value = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (value?.version !== JOURNAL_VERSION || !Array.isArray(value.events) || !value.indexes) {
      throw new Error("FOREX_JOURNAL_SCHEMA_INVALID");
    }
    return value;
  }

  function atomicWrite(value) {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > maxFileBytes) throw new Error("FOREX_JOURNAL_MAINTENANCE_REQUIRED");
    const directory = path.dirname(resolved);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${resolved}.${process.pid}.${randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, "wx");
    try { fs.writeFileSync(descriptor, body, "utf8"); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    try { fs.renameSync(temporary, resolved); }
    catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
    if (process.platform !== "win32") {
      const dir = fs.openSync(directory, "r");
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  }

  if (!fs.existsSync(resolved)) atomicWrite(blank());
  else read();

  async function append(type, payload, options = {}) {
    const task = (queues.get(resolved) || Promise.resolve()).then(() => {
      const lockPath = `${resolved}.lock`;
      let lock;
      try { lock = fs.openSync(lockPath, "wx"); }
      catch { throw new Error("FOREX_JOURNAL_LOCKED"); }
      try {
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: now() }));
        fs.fsyncSync(lock);
        const journal = read();
        const eventId = options.eventId || idFactory();
        if (journal.events.some((event) => event.eventId === eventId)) throw new Error("FOREX_JOURNAL_DUPLICATE_EVENT_ID");
        const event = createJournalEvent(type, payload, {
          timestamp: options.timestamp || now(),
          eventId,
          sequence: journal.sequence + 1,
        });
        journal.sequence = event.sequence;
        journal.events.push(event);
        journal.indexes.recent.push(event.eventId);
        journal.indexes.recent = journal.indexes.recent.slice(-maxIndexEntries);
        journal.indexes.byType[type] ||= [];
        journal.indexes.byType[type].push(event.eventId);
        journal.indexes.byType[type] = journal.indexes.byType[type].slice(-maxIndexEntries);
        atomicWrite(journal);
        return freeze(clone(event));
      } finally {
        if (lock !== undefined) fs.closeSync(lock);
        try { fs.unlinkSync(lockPath); } catch {}
      }
    });
    const settled = task.catch(() => {});
    queues.set(resolved, settled);
    try { return await task; }
    finally { if (queues.get(resolved) === settled) queues.delete(resolved); }
  }

  return Object.freeze({
    kind: "file",
    path: resolved,
    append,
    recordProviderObservation: (payload, options) => append("PROVIDER_OBSERVATION", payload, options),
    recordSnapshot: (payload, options) => append("EVIDENCE_SNAPSHOT", payload, options),
    recordDecision: (payload, options) => append("DECISION", payload, options),
    recordIntent: (payload, options) => append("INTENT", payload, options),
    recordFill: (payload, options) => append("FILL", payload, options),
    recordManagement: (payload, options) => append("MANAGEMENT", payload, options),
    recordOutcome: (payload, options) => append("OUTCOME", payload, options),
    async load({ type, limit } = {}) {
      const journal = read();
      const rows = type ? journal.events.filter((event) => event.type === type) : journal.events;
      const selected = Number.isFinite(limit) ? rows.slice(-Math.max(0, limit)) : rows;
      return freeze(clone({ version: journal.version, sequence: journal.sequence, events: selected, indexes: journal.indexes }));
    },
    async get(eventId) {
      const event = read().events.find((row) => row.eventId === eventId);
      return event ? freeze(clone(event)) : null;
    },
  });
}
