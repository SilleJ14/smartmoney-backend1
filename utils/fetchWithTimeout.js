export const DEFAULT_FETCH_TIMEOUT_MS = Number(
  process.env.DEFAULT_FETCH_TIMEOUT_MS || 12000
);

export async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}