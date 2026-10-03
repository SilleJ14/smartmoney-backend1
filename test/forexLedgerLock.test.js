import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createFileStore, reclaimableForexLock } from "../forex/durableStore.js";

function tempLedger(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forex-ledger-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, filePath: path.join(dir, "ledger.json") };
}

test("a lock file left by a crashed guarded process on this host is reclaimed at once", async (t) => {
  const { dir, filePath } = tempLedger(t);
  const store = createFileStore({ filePath, persistentRoot: dir });
  // PID 1 is alive on every host: this is the container-restart case.
  fs.writeFileSync(`${filePath}.lock`, JSON.stringify({ pid: 1, host: os.hostname(),
    acquiredAt: new Date().toISOString(), guardedBy: "sqlite" }));
  await store.commit((ledger) => ledger.audits.push("after-crash"));
  assert.deepEqual((await store.load()).audits, ["after-crash"]);
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
});

test("a legacy lock carrying our own reused PID is stale; a live foreign PID is not until the age cap", () => {
  const now = Date.parse("2026-10-02T09:00:00Z");
  const base = { lockPath: "unused", host: "h", hostname: "h", now, staleLockMs: 1000, processAlive: () => true };
  assert.equal(reclaimableForexLock({ ...base, owner: { pid: process.pid, host: "h", acquiredAt: new Date(now).toISOString() } }), true);
  assert.equal(reclaimableForexLock({ ...base, owner: { pid: 99999, host: "h", acquiredAt: new Date(now - 5000).toISOString() } }), false);
  assert.equal(reclaimableForexLock({ ...base, owner: { pid: 99999, host: "h", acquiredAt: new Date(now - 10000).toISOString() } }), true);
});

test("another live process holding the ledger lock blocks commits; its crash releases it", async (t) => {
  const { dir, filePath } = tempLedger(t);
  const store = createFileStore({ filePath, persistentRoot: dir });
  const lockModule = new URL("../forex/sqliteLock.js", import.meta.url).href;
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `
    import { withExclusiveSqliteLock } from ${JSON.stringify(lockModule)};
    await withExclusiveSqliteLock(${JSON.stringify(`${filePath}.lock.db`)}, async () => {
      console.log("held");
      await new Promise(() => setInterval(() => {}, 1000)); // hold until killed
    });`], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => holder.kill());
  await new Promise((resolve, reject) => {
    holder.stdout.on("data", (data) => { if (String(data).includes("held")) resolve(); });
    holder.once("exit", (code) => reject(new Error(`holder exited ${code}`)));
  });
  await assert.rejects(store.commit((ledger) => ledger.audits.push("contended")), /FOREX_LEDGER_LOCKED/);
  holder.kill("SIGKILL");
  await new Promise((resolve) => holder.once("exit", resolve));
  await store.commit((ledger) => ledger.audits.push("after-holder-died"));
  assert.deepEqual((await store.load()).audits, ["after-holder-died"]);
});

test("a briefly busy SQLite lock is retried, a persistently busy one reports LEDGER_LOCKED with its cause", async (t) => {
  const { withExclusiveSqliteLock } = await import("../forex/sqliteLock.js");
  const { default: Database } = await import("better-sqlite3");
  const { dir } = tempLedger(t);
  const lockDb = path.join(dir, "ledger.json.lock.db");
  const holder = new Database(lockDb);
  holder.exec("BEGIN IMMEDIATE");
  setTimeout(() => { holder.exec("COMMIT"); }, 60);
  assert.equal(await withExclusiveSqliteLock(lockDb, async ({ sqliteGuarded }) => sqliteGuarded), true);
  holder.exec("BEGIN IMMEDIATE");
  try {
    await assert.rejects(withExclusiveSqliteLock(lockDb, async () => "never", { attempts: 3, baseDelayMs: 5 }),
      (error) => error.message === "FOREX_LEDGER_LOCKED" && error.halt === "LEDGER_LOCKED" && /SQLITE_BUSY/.test(error.lockCause));
  } finally { holder.exec("COMMIT"); holder.close(); }
});

test("when SQLite locking is unusable on the volume, the ledger still commits under the file lock and says so", async (t) => {
  const { sqliteLockStatus } = await import("../forex/sqliteLock.js");
  const { dir, filePath } = tempLedger(t);
  fs.mkdirSync(`${filePath}.lock.db`); // a directory where the lock database should be: SQLite cannot open it
  const store = createFileStore({ filePath, persistentRoot: dir });
  await store.commit((ledger) => ledger.audits.push("file-lock-only"));
  assert.deepEqual((await store.load()).audits, ["file-lock-only"]);
  assert.equal(sqliteLockStatus().mode, "FILE_LOCK_ONLY");
  assert.ok(sqliteLockStatus().cause);
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
});

test("a calendar that cannot write its cache reports storage, not a network error", async () => {
  const { createEconomicCalendarProvider } = await import("../forex/economicCalendarProvider.js");
  let fetched = false;
  const provider = createEconomicCalendarProvider({ provider: "jblanked", jblankedApiKey: "test-key",
    store: { isDurable: () => true, commit: async () => { throw new Error("FOREX_LEDGER_LOCKED"); } },
    fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); } });
  const status = await provider.refresh();
  assert.equal(status.error, "CALENDAR_STORAGE_LOCKED");
  assert.equal(fetched, false);
});
