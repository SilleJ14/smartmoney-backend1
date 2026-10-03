import { oandaReconnectDelay } from "./oandaClient.js";

const sleep = (milliseconds, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(resolve, milliseconds);
  timer.unref?.();
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

export function createOandaStreamSupervisor({
  instruments = [],
  now = () => Date.now(),
  onPrice,
  onTransaction,
  onHealth,
  // A connection must stay up this long before backoff resets, so a stream
  // that connects, heartbeats once and drops cannot retry every 250 ms.
  stableConnectionMs = 60000,
  random = Math.random,
} = {}) {
  let generation = 0;
  let controller = null;
  const latestPrices = new Map();
  const health = {
    running: false,
    practiceOnly: true,
    pricing: { connected: false, lastMessageAt: null, lastHeartbeatAt: null, reconnects: 0, error: null },
    transactions: { connected: false, lastMessageAt: null, lastHeartbeatAt: null, reconnects: 0, error: null },
  };

  const publish = () => onHealth?.(snapshot());

  async function runLane(client, lane, source, handle, currentGeneration, signal) {
    let attempt = 0;
    while (!signal.aborted && currentGeneration === generation) {
      try {
        health[lane].connected = true;
        health[lane].error = null;
        publish();
        const connectedAt = now();
        for await (const event of source(signal)) {
          if (signal.aborted || currentGeneration !== generation) break;
          const timestamp = new Date(now()).toISOString();
          health[lane].lastMessageAt = timestamp;
          if (event?.type === "HEARTBEAT") health[lane].lastHeartbeatAt = event.time || timestamp;
          await handle(event);
          if (now() - connectedAt >= stableConnectionMs) attempt = 0;
          publish();
        }
        if (!signal.aborted) throw new Error("OANDA_STREAM_ENDED");
      } catch (error) {
        if (signal.aborted || currentGeneration !== generation) break;
        health[lane].connected = false;
        health[lane].error = String(error?.message || error);
        health[lane].reconnects += 1;
        publish();
        // Jitter (50-100% of the backoff) keeps both lanes and restarts from
        // reconnecting in lockstep.
        const delay = oandaReconnectDelay(attempt++);
        await sleep(Math.round(delay * (0.5 + 0.5 * random())), signal);
      }
    }
    health[lane].connected = false;
    publish();
  }

  function start(client) {
    stop();
    if (!client?.token || client.liveHost) {
      health.running = false;
      health.pricing.error = client?.liveHost ? "LIVE_BLOCKED" : "MISSING_CREDENTIALS";
      health.transactions.error = health.pricing.error;
      publish();
      return;
    }
    controller = new AbortController();
    const currentGeneration = ++generation;
    health.running = true;
    runLane(
      client,
      "pricing",
      signal => client.streamPrices(instruments, { signal }),
      async event => {
        if (event?.type === "PRICE" && event.instrument) latestPrices.set(event.instrument, event);
        await onPrice?.(event);
      },
      currentGeneration,
      controller.signal
    ).catch(() => {});
    runLane(
      client,
      "transactions",
      signal => client.streamTransactions({ signal }),
      event => onTransaction?.(event),
      currentGeneration,
      controller.signal
    ).catch(() => {});
  }

  function stop() {
    generation += 1;
    controller?.abort();
    controller = null;
    health.running = false;
    health.pricing.connected = false;
    health.transactions.connected = false;
  }

  function snapshot() {
    const cloned = {
      running: health.running,
      practiceOnly: true,
      pricing: { ...health.pricing },
      transactions: { ...health.transactions },
      cachedPriceCount: latestPrices.size,
    };
    return Object.freeze(cloned);
  }

  return Object.freeze({
    start,
    stop,
    snapshot,
    getPrice: instrument => latestPrices.get(instrument) || null,
  });
}
