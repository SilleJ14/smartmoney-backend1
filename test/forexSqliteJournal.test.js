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
