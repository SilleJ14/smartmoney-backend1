import fs from "fs";

const DEFAULT_MAX_LOAD_BYTES = 256 * 1024 * 1024;
const DEFAULT_BACKUP_THRESHOLD_BYTES = 25 * 1024 * 1024;

export function loadPersistedEngineState(
  engineStateFile,
  {
    maxLoadBytes = Number(process.env.ENGINE_STATE_MAX_LOAD_BYTES) || DEFAULT_MAX_LOAD_BYTES,
    backupThresholdBytes = DEFAULT_BACKUP_THRESHOLD_BYTES,
  } = {}
) {
  try {
    if (!fs.existsSync(engineStateFile)) return {};

    const fileSize = fs.statSync(engineStateFile).size;
    if (fileSize > maxLoadBytes) {
      const oversizedFile = `${engineStateFile}.oversized-${Date.now()}`;
      fs.renameSync(engineStateFile, oversizedFile);
      console.error(
        `Engine state exceeded the safe load budget and was archived: ${oversizedFile}`
      );
      return { safetyReconciliationRequired: true, safetyStateLoadFailed: true };
    }
    if (fileSize > backupThresholdBytes) {
      const migrationBackup = `${engineStateFile}.pre-memory-compaction`;
      if (!fs.existsSync(migrationBackup)) {
        fs.copyFileSync(engineStateFile, migrationBackup);
      }
    }

    const raw = fs.readFileSync(engineStateFile, "utf8").trim();

    if (!raw) {
      throw new Error('Empty engine state');
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid engine state');
    return parsed;
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

    return { safetyReconciliationRequired: true, safetyStateLoadFailed: true };
  }
}
