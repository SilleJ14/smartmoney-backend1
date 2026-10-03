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
