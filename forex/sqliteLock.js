import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Cross-process mutual exclusion backed by SQLite's file locking. The operating
// system releases the lock when the holder exits or crashes, so it can never be
// left behind, misattributed to a reused PID, or stolen by a racing reclaimer.
// Acquisition never waits (timeout 0): a busy lock fails fast instead of
// blocking the event loop.
export async function withExclusiveSqliteLock(lockDbPath, work) {
  let db;
  try {
    fs.mkdirSync(path.dirname(lockDbPath), { recursive: true });
    db = new Database(lockDbPath, { timeout: 0 });
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    try { db?.close(); } catch { /* already closed */ }
    throw Object.assign(new Error("FOREX_LEDGER_LOCKED"), { cause: error });
  }
  try {
    return await work();
  } finally {
    try { db.exec("COMMIT"); } catch { /* closing still releases the lock */ }
    db.close();
  }
}
