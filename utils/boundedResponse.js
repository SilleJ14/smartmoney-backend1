export function cancelResponseBody(response) {
  // A provider's cancellation can itself stall or reject: never await it.
  try {
    if (response.body?.destroy) response.body.destroy();
    else void Promise.resolve(response.body?.cancel?.()).catch(() => {});
  } catch { /* best effort */ }
}

// Bound the body during download, before allocating/parsing the full payload.
export async function readBoundedResponseText(response, { maxBytes = 2 * 1024 * 1024, timeoutMs = 12000, onBytesRead = () => {} } = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    cancelResponseBody(response);
    throw new Error("Invalid response budget");
  }
  if (Number(response.headers?.get?.("content-length") || 0) > maxBytes) {
    cancelResponseBody(response);
    throw new Error("Response byte budget exceeded");
  }
  const reader = response.body?.getReader?.();
  const iterator = !reader ? response.body?.[Symbol.asyncIterator]?.() : null;
  let stopped = false;
  const cancel = () => {
    stopped = true;
    try {
      if (reader) void Promise.resolve(reader.cancel()).catch(() => {});
      else cancelResponseBody(response);
    } catch { /* preserve the original failure */ }
  };
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Response body deadline exceeded"));
      cancel();
    }, timeoutMs);
  });
  const read = async () => {
    if (!reader && !iterator) {
      // Compatibility with in-memory test responses; real fetch bodies stream.
      const text = await response.text();
      if (stopped) throw new Error("Response body deadline exceeded");
      onBytesRead(Buffer.byteLength(text));
      if (Buffer.byteLength(text) > maxBytes) throw new Error("Response byte budget exceeded");
      return text;
    }
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await (reader ? reader.read() : iterator.next());
      if (stopped) throw new Error("Response body deadline exceeded");
      if (done) break;
      const length = typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
      bytes += length;
      onBytesRead(length);
      if (bytes > maxBytes) {
        throw new Error("Response byte budget exceeded");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  };
  try { return await Promise.race([read(), timeout]); }
  catch (error) { cancel(); throw error; }
  finally { clearTimeout(timer); try { reader?.releaseLock(); } catch { /* pending cancelled read */ } }
}

export async function readBoundedResponseJson(response, options) {
  return JSON.parse(await readBoundedResponseText(response, options));
}
