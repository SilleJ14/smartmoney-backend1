import fs from "fs";
import path from "path";

const RENDER_DISK_CANDIDATES = Object.freeze(["/var/data", "/data"]);

function canWriteDirectory(directory, { mkdir, writeFile, unlink } = {}) {
  try {
    mkdir(directory, { recursive: true });
    const probe = path.join(directory, `.smartmoney-write-probe.${process.pid}`);
    writeFile(probe, "ok");
    unlink(probe);
    return true;
  } catch {
    return false;
  }
}

export function resolveDataDir({
  env = process.env,
  cwd = process.cwd(),
  mkdir = (directory, options) => fs.mkdirSync(directory, options),
  writeFile = (file, contents) => fs.writeFileSync(file, contents),
  unlink = (file) => fs.unlinkSync(file),
} = {}) {
  const requested = String(env.DATA_DIR || "").trim();
  if (requested) {
    const resolved = path.resolve(requested);
    if (!env.RENDER || resolved !== path.resolve(cwd)) return resolved;
  }
  if (env.RENDER) {
    const mounts = [
      env.RENDER_DISK_MOUNT_PATH,
      ...RENDER_DISK_CANDIDATES,
    ].filter(Boolean).map((directory) => path.resolve(String(directory)));
    for (const directory of mounts) {
      if (canWriteDirectory(directory, { mkdir, writeFile, unlink })) return directory;
    }
  }
  return path.resolve(cwd);
}

export function defaultDurableUserFiles({ platform = process.platform } = {}) {
  if (platform === "win32") return [];
  return RENDER_DISK_CANDIDATES.map((directory) => path.posix.join(directory, "users.json"));
}
