export const DEFAULT_FETCH_TIMEOUT_MS = Number(
  process.env.DEFAULT_FETCH_TIMEOUT_MS || 12000
);

export async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
) {
  const controller = new AbortController();
  // Keep caller cancellation connected after headers arrive (including while
  // the response body is being read), without disabling our request deadline.
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
