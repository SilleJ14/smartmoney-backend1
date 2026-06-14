import fs from "fs";
import path from "path";

export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);

  await fs.promises.mkdir(dir, {
    recursive: true,
  });

  const tempFile = `${filePath}.tmp`;

  const json = JSON.stringify(data, null, 2);

  await fs.promises.writeFile(
    tempFile,
    json,
    "utf8"
  );

  await fs.promises.rename(
    tempFile,
    filePath
  );

  return true;
}

export async function readJsonSafe(
  filePath,
  fallback = null
) {
  try {
    const exists = fs.existsSync(filePath);

    if (!exists) {
      return fallback;
    }

    const raw = await fs.promises.readFile(
      filePath,
      "utf8"
    );

    if (!raw || !raw.trim()) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (err) {
    console.error(
      "readJsonSafe:",
      err?.message
    );

    return fallback;
  }
}

export function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export async function deleteFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }

    return true;
  } catch (err) {
    console.error(
      "deleteFileSafe:",
      err?.message
    );

    return false;
  }
}