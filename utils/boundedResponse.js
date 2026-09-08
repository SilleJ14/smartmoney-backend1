// Bound the body during download, before allocating/parsing the full payload.
export async function readBoundedResponseText(response, { maxBytes = 2 * 1024 * 1024, timeoutMs = 12000, onBytesRead = () => {} } = {}) {
  if (Number(response.headers?.get?.("content-length") || 0) > maxBytes) {
    await response.body?.cancel?.();
    throw new Error("Response byte budget exceeded");
  }
  const reader = response.body?.getReader?.();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Response body deadline exceeded"));
      void reader?.cancel().catch(() => {});
    }, timeoutMs);
  });
  const read = async () => {
    if (!reader) {
      const text = await response.text();
      onBytesRead(Buffer.byteLength(text));
      if (Buffer.byteLength(text) > maxBytes) throw new Error("Response byte budget exceeded");
      return text;
    }
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      onBytesRead(value.byteLength);
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Response byte budget exceeded");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  };
  try { return await Promise.race([read(), timeout]); }
  finally { clearTimeout(timer); reader?.releaseLock(); }
}
