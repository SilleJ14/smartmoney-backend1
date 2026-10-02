import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const SCHEMA_VERSION = 1;
const EVENT_TYPES = new Set([
  "PROVIDER_OBSERVATION",
  "FEATURE_SNAPSHOT",
  "DECISION",
  "ORDER_INTENT",
  "FILL",
  "MANAGEMENT_ACTION",
  "OUTCOME",
  "DATA_QUALITY",
  "STRATEGY_REVIEW",
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function json(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function createForexSqliteJournal({
  filePath,
  persistentRoot,
  codeVersion = process.env.RENDER_GIT_COMMIT || "local",
  readonly = false,
} = {}) {
  if (!filePath) throw new Error("FOREX_JOURNAL_PATH_REQUIRED");
  const resolved = path.resolve(filePath);
  const root = persistentRoot ? path.resolve(persistentRoot) : null;
  if (root) {
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("FOREX_JOURNAL_OUTSIDE_PERSISTENT_ROOT");
    }
  }
  if (!readonly) fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const database = new Database(resolved, {
    readonly,
    fileMustExist: readonly,
    timeout: 5000,
  });
  database.pragma("foreign_keys = ON");
  if (!readonly) {
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = FULL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS forex_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        entity_id TEXT,
        snapshot_id TEXT,
        schema_version INTEGER NOT NULL,
        code_version TEXT NOT NULL,
        config_hash TEXT,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS forex_events_time_idx
        ON forex_events(occurred_at, event_type);
      CREATE INDEX IF NOT EXISTS forex_events_entity_idx
        ON forex_events(entity_id, occurred_at);
      CREATE TABLE IF NOT EXISTS forex_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        observed_at TEXT NOT NULL,
        decision_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        code_version TEXT NOT NULL,
        config_hash TEXT,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS forex_snapshots_decision_idx
        ON forex_snapshots(decision_at);
    `);
    database.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  const insertEvent = database.prepare(`
    INSERT INTO forex_events (
      event_id, event_type, occurred_at, entity_id, snapshot_id,
      schema_version, code_version, config_hash, payload_json, payload_hash
    ) VALUES (
      @eventId, @eventType, @occurredAt, @entityId, @snapshotId,
      @schemaVersion, @codeVersion, @configHash, @payloadJson, @payloadHash
    )
  `);
  const insertSnapshot = database.prepare(`
    INSERT INTO forex_snapshots (
      snapshot_id, observed_at, decision_at, schema_version,
      code_version, config_hash, payload_json, payload_hash
    ) VALUES (
      @snapshotId, @observedAt, @decisionAt, @schemaVersion,
      @codeVersion, @configHash, @payloadJson, @payloadHash
    )
  `);

  function append(event = {}) {
    if (readonly) throw new Error("FOREX_JOURNAL_READ_ONLY");
    if (!EVENT_TYPES.has(event.type)) throw new Error("FOREX_JOURNAL_EVENT_TYPE_INVALID");
    const occurredAt = validTimestamp(event.occurredAt);
    if (!occurredAt) throw new Error("FOREX_JOURNAL_TIMESTAMP_INVALID");
    const payloadJson = json(event.payload ?? null);
    const row = {
      eventId: event.eventId || `fxe-${randomUUID()}`,
      eventType: event.type,
      occurredAt,
      entityId: event.entityId || null,
      snapshotId: event.snapshotId || null,
      schemaVersion: SCHEMA_VERSION,
      codeVersion: event.codeVersion || codeVersion,
      configHash: event.configHash || null,
      payloadJson,
      payloadHash: sha256(payloadJson),
    };
    insertEvent.run(row);
    return Object.freeze({ ...row, payload: event.payload ?? null });
  }

  function recordSnapshot(snapshot = {}) {
    if (readonly) throw new Error("FOREX_JOURNAL_READ_ONLY");
    const observedAt = validTimestamp(snapshot.observedAt);
    const decisionAt = validTimestamp(snapshot.decisionAt);
    if (!observedAt || !decisionAt) throw new Error("FOREX_SNAPSHOT_TIMESTAMP_INVALID");
    const payloadJson = json(snapshot.payload ?? null);
    const payloadHash = sha256(payloadJson);
    const snapshotId = snapshot.snapshotId || `fxs-${payloadHash}`;
    insertSnapshot.run({
      snapshotId,
      observedAt,
      decisionAt,
      schemaVersion: SCHEMA_VERSION,
      codeVersion: snapshot.codeVersion || codeVersion,
      configHash: snapshot.configHash || null,
      payloadJson,
      payloadHash,
    });
    append({
      type: "FEATURE_SNAPSHOT",
      occurredAt: decisionAt,
      entityId: snapshot.entityId,
      snapshotId,
      configHash: snapshot.configHash,
      payload: { payloadHash, observedAt },
    });
    return Object.freeze({ snapshotId, observedAt, decisionAt, payloadHash });
  }

  return {
    kind: "sqlite-wal",
    path: resolved,
    schemaVersion: SCHEMA_VERSION,
    isDurable: () => !readonly && (!root || resolved.startsWith(`${root}${path.sep}`)),
    append,
    recordSnapshot,
    transaction: (worker) => database.transaction(worker)(),
    getSnapshot(snapshotId) {
      const row = database.prepare("SELECT * FROM forex_snapshots WHERE snapshot_id = ?").get(snapshotId);
      return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
    },
    listEvents({ type, entityId, limit = 100 } = {}) {
      const bounded = Math.max(1, Math.min(1000, Number(limit) || 100));
      const clauses = [];
      const params = {};
      if (type) { clauses.push("event_type = @type"); params.type = type; }
      if (entityId) { clauses.push("entity_id = @entityId"); params.entityId = entityId; }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return database.prepare(
        `SELECT * FROM forex_events ${where} ORDER BY occurred_at DESC LIMIT ${bounded}`
      ).all(params).map(row => ({ ...row, payload: JSON.parse(row.payload_json) }));
    },
    health() {
      const result = database.pragma("integrity_check", { simple: true });
      return {
        ok: result === "ok",
        kind: "sqlite-wal",
        schemaVersion: database.pragma("user_version", { simple: true }),
        eventCount: database.prepare("SELECT COUNT(*) AS count FROM forex_events").get().count,
        snapshotCount: database.prepare("SELECT COUNT(*) AS count FROM forex_snapshots").get().count,
      };
    },
    close: () => database.close(),
  };
}
