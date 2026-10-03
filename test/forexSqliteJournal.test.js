import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createForexSqliteJournal } from "../forex/sqliteJournal.js";

test("SQLite WAL journal persists immutable snapshots and linked events", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-sqlite-"));
  const filePath = path.join(root, "journal.sqlite");
  const journal = createForexSqliteJournal({ filePath, persistentRoot: root, codeVersion: "test" });
  t.after(() => {
    journal.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const snapshot = journal.recordSnapshot({
    observedAt: "2026-10-02T05:00:00Z",
    decisionAt: "2026-10-02T05:00:01Z",
    entityId: "EUR_USD",
    configHash: "cfg",
    payload: { quote: { bid: 1.1, ask: 1.1001 }, missing: null },
  });
  journal.append({
    type: "DECISION",
    occurredAt: "2026-10-02T05:00:01Z",
    entityId: "EUR_USD",
    snapshotId: snapshot.snapshotId,
    configHash: "cfg",
    payload: { decision: "WAIT", probability: null },
  });
  assert.equal(journal.health().ok, true);
  assert.equal(journal.health().snapshotCount, 1);
  assert.equal(journal.listEvents({ entityId: "EUR_USD" }).length, 2);
  assert.equal(journal.getSnapshot(snapshot.snapshotId).payload.missing, null);
  assert.throws(() => journal.append({
    type: "DECISION",
    occurredAt: "bad",
    payload: {},
  }), /TIMESTAMP/);
});

test("SQLite journal refuses paths outside the persistent root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-sqlite-root-"));
  try {
    assert.throws(() => createForexSqliteJournal({
      filePath: path.join(os.tmpdir(), "outside.sqlite"),
      persistentRoot: root,
    }), /OUTSIDE_PERSISTENT_ROOT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retention prunes old analysis records in small batches but keeps order and fill records", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-sqlite-retention-"));
  const journal = createForexSqliteJournal({ filePath: path.join(root, "journal.sqlite"), persistentRoot: root, codeVersion: "test" });
  t.after(() => { journal.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const now = Date.parse("2026-10-20T00:00:00Z");
  const old = "2026-10-01T00:00:00Z", recent = "2026-10-19T00:00:00Z";
  for (let i = 0; i < 3; i += 1) {
    journal.recordSnapshot({ observedAt: old, decisionAt: old, entityId: "EUR_USD", payload: { i, old: true } });
    journal.append({ type: "DECISION", occurredAt: old, entityId: "EUR_USD", payload: { i } });
  }
  journal.append({ type: "ORDER_INTENT", occurredAt: old, entityId: "EUR_USD", payload: { id: "keep" } });
  journal.append({ type: "FILL", occurredAt: old, entityId: "EUR_USD", payload: { id: "keep" } });
  journal.recordSnapshot({ observedAt: recent, decisionAt: recent, entityId: "EUR_USD", payload: { recent: true } });
  const first = journal.prune({ now, batchSize: 2 });
  assert.equal(first.snapshots, 2, "one small batch at a time");
  journal.prune({ now, batchSize: 2 });
  journal.prune({ now, batchSize: 50 });
  assert.equal(journal.health().snapshotCount, 1);
  const types = journal.listEvents({ limit: 100 }).map((event) => event.event_type).sort();
  assert.deepEqual(types.filter((type) => type !== "FEATURE_SNAPSHOT"), ["FILL", "ORDER_INTENT"]);
  assert.equal(types.filter((type) => type === "FEATURE_SNAPSHOT").length, 1, "only the recent snapshot event remains");
  assert.equal(journal.health().ok, true);
});

test("retention also enforces a size cap, oldest analysis records first", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-sqlite-cap-"));
  const journal = createForexSqliteJournal({ filePath: path.join(root, "journal.sqlite"), persistentRoot: root, codeVersion: "test" });
  t.after(() => { journal.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const at = new Date().toISOString();
  for (let i = 0; i < 40; i += 1) journal.recordSnapshot({ observedAt: at, decisionAt: at, entityId: "EUR_USD", payload: { i, blob: "x".repeat(20000) } });
  const before = journal.health().usedBytes;
  const result = journal.prune({ maxBytes: 1, batchSize: 10 });
  assert.equal(result.snapshots, 10);
  assert.ok(result.usedBytes < before);
  assert.equal(journal.health().snapshotCount, 30);
});

test("health is cheap and cached: it never re-runs the integrity check per call", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-sqlite-health-"));
  const journal = createForexSqliteJournal({ filePath: path.join(root, "journal.sqlite"), persistentRoot: root, codeVersion: "test" });
  t.after(() => { journal.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const source = fs.readFileSync(new URL("../forex/sqliteJournal.js", import.meta.url), "utf8");
  const health = source.slice(source.indexOf("    health() {"), source.indexOf("    prune("));
  assert.doesNotMatch(health, /integrity_check|quick_check|COUNT\(\*\)/);
  assert.equal(journal.health().ok, true);
});

test("a full disk is labelled STORAGE_FULL by the calendar, not a network error", async () => {
  const { createEconomicCalendarProvider } = await import("../forex/economicCalendarProvider.js");
  const provider = createEconomicCalendarProvider({ provider: "jblanked", jblankedApiKey: "test-key",
    store: { isDurable: () => true, commit: async () => { throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }); } },
    fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal((await provider.refresh()).error, "CALENDAR_STORAGE_FULL");
});

test("the size cap never prunes evidence that a kept order or fill record points to", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fx-sqlite-ref-"));
  const journal = createForexSqliteJournal({ filePath: path.join(root, "journal.sqlite"), persistentRoot: root, codeVersion: "test" });
  t.after(() => { journal.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const at = new Date().toISOString();
  const kept = journal.recordSnapshot({ observedAt: at, decisionAt: at, entityId: "EUR_USD", payload: { order: true } });
  journal.append({ type: "ORDER_INTENT", occurredAt: at, entityId: "EUR_USD", snapshotId: kept.snapshotId, payload: { id: "o1" } });
  for (let i = 0; i < 5; i += 1) journal.recordSnapshot({ observedAt: at, decisionAt: at, entityId: "EUR_USD", payload: { i } });
  journal.prune({ maxBytes: 1, batchSize: 50 });
  assert.ok(journal.getSnapshot(kept.snapshotId), "the order's evidence snapshot survives the size cap");
  assert.equal(journal.health().snapshotCount, 1);
});
