import fs from "fs";

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

  fs.writeFileSync(configFile, JSON.stringify(next, null, 2));
  return next;
}