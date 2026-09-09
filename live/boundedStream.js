const states = new WeakMap();
export const DEFAULT_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;
export const DEFAULT_STREAM_CLIENT_LIMIT = 16;

const boundedPositive = (value, fallback, ceiling) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(ceiling, Math.floor(number)) : fallback;
};

export function closeBoundedStream(response) {
  const state = states.get(response);
  if (state?.closed) return;
  if (state) {
    state.closed = true;
    state.clearTimer(state.timer);
    response.removeListener?.("drain", state.onDrain);
    response.removeListener?.("close", state.onClose);
    response.removeListener?.("error", state.onClose);
    try { state.cleanup(); } catch { /* A cleanup failure must not retain the socket. */ }
  }
  // End alone can leave an unboundedly slow socket flushing buffered bytes.
  try {
    if (typeof response.destroy === "function") response.destroy();
    else response.end?.();
  } catch { /* The peer may already be gone. */ }
}

export function attachBoundedStream(response, {
  onClose = () => {}, maxBufferedBytes = DEFAULT_STREAM_BUFFER_BYTES,
  maxBackpressureMs = 5000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
} = {}) {
  if (states.has(response)) return;
  const state = {
    closed: false, blocked: false, queuedBytes: 0, timer: null, cleanup: onClose,
    maxBufferedBytes: boundedPositive(maxBufferedBytes, DEFAULT_STREAM_BUFFER_BYTES, 4 * 1024 * 1024),
    maxBackpressureMs: boundedPositive(maxBackpressureMs, 5000, 15000),
    setTimer: setTimeoutFn, clearTimer: clearTimeoutFn,
    onDrain: null, onClose: null,
  };
  state.onDrain = () => {
    state.blocked = false;
    state.queuedBytes = 0;
    state.clearTimer(state.timer);
    state.timer = null;
  };
  state.onClose = () => closeBoundedStream(response);
  states.set(response, state);
  response.on?.("drain", state.onDrain);
  response.on?.("close", state.onClose);
  response.on?.("error", state.onClose);
}

// Node's write(false) still accepted the bytes. Preserve complete events for
// healthy clients, but cap bytes queued behind a stalled socket and terminate
// it if it does not drain. Clients reconnect/poll rather than missing silent
// partial event drops. There is no additional JavaScript event queue.
export function writeBoundedStream(response, message) {
  if (!states.has(response)) attachBoundedStream(response);
  const state = states.get(response);
  if (state.closed || response.destroyed || response.writableEnded) {
    closeBoundedStream(response);
    return false;
  }
  const bytes = Buffer.byteLength(message, "utf8");
  const queued = Math.max(state.queuedBytes, Number(response.writableLength) || 0,
    Number(response.socket?.writableLength) || 0);
  if (bytes > state.maxBufferedBytes || queued + bytes > state.maxBufferedBytes) {
    closeBoundedStream(response);
    return false;
  }
  try {
    const acceptedWithoutBackpressure = response.write(message) !== false;
    if (!acceptedWithoutBackpressure || state.blocked) {
      state.queuedBytes = queued + bytes;
      if (!state.blocked) {
        state.blocked = true;
        state.timer = state.setTimer(() => closeBoundedStream(response), state.maxBackpressureMs);
        state.timer?.unref?.();
      }
    }
    return true;
  } catch {
    closeBoundedStream(response);
    return false;
  }
}
