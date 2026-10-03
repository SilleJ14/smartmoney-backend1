import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Cross-process mutual exclusion backed by SQLite's file locking. The operating
// system releases the lock when the holder exits or crashes, so it can never be
// left behind, misattributed to a reused PID, or stolen by a racing reclaimer.
// Acquisition never blocks the event loop (busy timeout 0); a busy lock is
// retried briefly with async waits before failing.
//
// If SQLite locking itself does not work on the volume (cannot open, read-only,
// I/O or lock errors rather than "busy"), `work` still runs, guarded only by the
// caller's legacy lock file and in-process queue, exactly as before this lock
// existed. `work` receives { sqliteGuarded } so the caller can record that.
const BUSY_CODES = new Set(["SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_BUSY_SNAPSHOT", "SQLITE_BUSY_RECOVERY"]);
const describe = (error) => `${error?.code || error?.name || "Error"}: ${String(error?.message || error)}`.slice(0, 200);
let lastUnavailable = null;

export function sqliteLockStatus() {
  return lastUnavailable ? { mode: "FILE_LOCK_ONLY", cause: lastUnavailable } : { mode: "SQLITE", cause: null };
}

export async function withExclusiveSqliteLock(lockDbPath, work, { attempts = 6, baseDelayMs = 25, onUnavailable = () => {} } = {}) {
  let db = null;
  let failure = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(lockDbPath), { recursive: true });
      db = new Database(lockDbPath, { timeout: 0 });
      db.exec("BEGIN IMMEDIATE");
      failure = null;
      break;
    } catch (error) {
      try { db?.close(); } catch { /* already closed */ }
      db = null;
      failure = error;
      if (!BUSY_CODES.has(error?.code)) break;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  if (failure) {
    if (!BUSY_CODES.has(failure?.code)) {
      const cause = describe(failure);
      if (lastUnavailable !== cause) console.warn("FOREX_LEDGER_SQLITE_LOCK_UNAVAILABLE", cause);
      lastUnavailable = cause;
      onUnavailable(failure);
      return work({ sqliteGuarded: false });
    }
    throw Object.assign(new Error("FOREX_LEDGER_LOCKED"), {
      cause: failure, lockCause: describe(failure), halt: "LEDGER_LOCKED", reason: "LEDGER_LOCKED",
    });
  }
  lastUnavailable = null;
  try {
    return await work({ sqliteGuarded: true });
  } finally {
    try { db.exec("COMMIT"); } catch { /* closing still releases the lock */ }
    db.close();
  }
}
