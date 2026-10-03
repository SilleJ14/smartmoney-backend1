import fs from "fs";
import path from "path";

// Distinguishes "never saved" from "saved but unreadable": an unreadable file
// may have held the owner's emergency stop or Autopilot OFF choice.
export function inspectRuntimeConfig(configFile) {
  if (!fs.existsSync(configFile)) return { config: {}, corrupt: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return { config: parsed, corrupt: false };
  } catch {
    return { config: {}, corrupt: true };
  }
}

export function loadRuntimeConfig(configFile) {
  return inspectRuntimeConfig(configFile).config;
}

export function saveRuntimeConfig(configFile, updates = {}) {
  const { config: current, corrupt } = inspectRuntimeConfig(configFile);
  if (corrupt) {
    // Keep the unreadable original for the owner instead of overwriting it.
    try { fs.copyFileSync(configFile, `${configFile}.corrupt-${Date.now()}`); } catch { }
  }

  const next = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  const temporaryFile = `${configFile}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(next, null, 2), "utf8");
    try {
      fs.renameSync(temporaryFile, configFile);
    } catch (error) {
      if (process.platform !== "win32" || !["EEXIST", "EPERM"].includes(error?.code)) throw error;
      fs.copyFileSync(temporaryFile, configFile);
      fs.unlinkSync(temporaryFile);
    }
  } catch (error) {
    try {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    } catch { }
    throw error;
  }

  return next;
}
