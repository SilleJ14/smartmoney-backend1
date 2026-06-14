import fs from "fs";

export function loadPersistedEngineState(engineStateFile) {
  try {
    if (!fs.existsSync(engineStateFile)) return {};

    const raw = fs.readFileSync(engineStateFile, "utf8").trim();

    if (!raw) {
      return {};
    }

    return JSON.parse(raw);
  } catch (err) {
    console.error(
      "Could not load engine-state.json:",
      err.message
    );

    try {
      const backupFile =
        `${engineStateFile}.bad-${Date.now()}`;

      fs.renameSync(engineStateFile, backupFile);

      console.error(
        "Corrupt engine-state.json moved to:",
        backupFile
      );
    } catch {}

    return {};
  }
}