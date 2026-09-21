import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDataDir, defaultDurableUserFiles } from "../storage/dataDirectory.js";
import { resolveDurableUserFiles } from "../security/adminAuth.js";

test("Render prefers a writable disk mount over the checkout directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-data-dir-"));
  const disk = path.join(root, "disk");
  const checkout = path.join(root, "checkout");
  fs.mkdirSync(checkout);
  const resolved = resolveDataDir({
    env: { RENDER: "true", RENDER_DISK_MOUNT_PATH: disk },
    cwd: checkout,
  });
  assert.equal(resolved, path.resolve(disk));
  fs.rmSync(root, { recursive: true, force: true });
});

test("durable user files keep the Render disk path even before the file exists", () => {
  assert.deepEqual(defaultDurableUserFiles({ platform: "linux" }), ["/var/data/users.json", "/data/users.json"]);
  const files = resolveDurableUserFiles("/tmp/checkout/users.json", [], { platform: "linux" });
  assert.ok(files.some((file) => file.endsWith(`${path.sep}var${path.sep}data${path.sep}users.json`) || file.replaceAll("\\", "/").endsWith("/var/data/users.json")));
});
