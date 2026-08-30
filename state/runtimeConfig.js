import fs from "fs";
import path from "path";

export function loadRuntimeConfig(configFile) {
  try {
    if (!fs.existsSync(configFile)) return {};
    return JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {
    return {};
  }
}

export function saveRuntimeConfig(configFile, updates = {}) {
  const current = loadRuntimeConfig(configFile);

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
