import fs from "fs";
import path from "path";

export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);

  await fs.promises.mkdir(dir, {
    recursive: true,
  });

  const tempFile = `${filePath}.tmp`;

  // Persist compact JSON. Pretty-printing large engine snapshots can add
  // tens of megabytes and keeps that larger string resident during writes.
  const json = JSON.stringify(data);

  // writeFile(string) creates a second full-size UTF-8 buffer. Keep the exact
  // synchronous JSON snapshot above, but encode/write it in bounded pieces.
  // This avoids mixing evidence from different times during asynchronous I/O.
  const handle = await fs.promises.open(tempFile, 'w');
  try {
    for (let offset = 0; offset < json.length;) {
      let end = Math.min(json.length, offset + 64 * 1024);
      const last = json.charCodeAt(end - 1);
      if (end < json.length && last >= 0xD800 && last <= 0xDBFF) end--;
      const buffer = Buffer.from(json.slice(offset, end), 'utf8');
      let written = 0;
      while (written < buffer.length) {
        const result = await handle.write(buffer, written, buffer.length - written);
        if (!result.bytesWritten) throw new Error('Atomic JSON write made no progress');
        written += result.bytesWritten;
      }
      offset = end;
    }
  } finally {
    await handle.close();
  }

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
