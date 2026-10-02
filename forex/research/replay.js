function time(value, field) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be a valid timestamp`);
  return parsed;
}

function normalize(record, kind) {
  const observedAt = time(record.observedAt ?? record.time ?? record.timestamp ?? record.closeTime, "observedAt");
  const availableAt = time(record.availableAt ?? (kind === "candle" ? record.closeTime : observedAt), "availableAt");
  if (availableAt < observedAt && kind === "candle") {
    throw new Error("A candle cannot be available before it is observed");
  }
  return Object.freeze({ ...record, kind, observedAt, availableAt });
}

export function prepareReplay({ candles = [], events = [] } = {}) {
  return [
    ...candles.map((row) => normalize(row, "candle")),
    ...events.map((row) => normalize(row, "event")),
  ].sort((a, b) => a.availableAt - b.availableAt || a.observedAt - b.observedAt
    || String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

export function visibleAt(records, asOf) {
  const cutoff = time(asOf, "asOf");
  return records.filter((row) => row.availableAt <= cutoff);
}

export function latestVintages(events, asOf) {
  const cutoff = time(asOf, "asOf");
  const latest = new Map();
  for (const raw of events) {
    const row = raw.kind ? raw : normalize(raw, "event");
    if (row.availableAt > cutoff || row.observedAt > cutoff) continue;
    const key = String(row.seriesId ?? row.eventId ?? row.id);
    const previous = latest.get(key);
    if (!previous || row.availableAt > previous.availableAt
      || (row.availableAt === previous.availableAt && Number(row.vintage ?? 0) > Number(previous.vintage ?? 0))) {
      latest.set(key, row);
    }
  }
  return [...latest.values()].sort((a, b) => a.observedAt - b.observedAt);
}

export class PointInTimeReplay {
  #records;
  #cursor = 0;
  #clock = -Infinity;

  constructor(input = {}) {
    this.#records = Array.isArray(input) ? prepareReplay({ events: input }) : prepareReplay(input);
  }

  advanceTo(asOf) {
    const nextClock = time(asOf, "asOf");
    if (nextClock < this.#clock) throw new Error("Replay clock cannot move backwards");
    const released = [];
    while (this.#cursor < this.#records.length && this.#records[this.#cursor].availableAt <= nextClock) {
      released.push(this.#records[this.#cursor++]);
    }
    this.#clock = nextClock;
    return released;
  }

  snapshot() {
    const known = this.#records.slice(0, this.#cursor);
    return Object.freeze({
      asOf: this.#clock,
      candles: known.filter((row) => row.kind === "candle"),
      events: latestVintages(known.filter((row) => row.kind === "event"), this.#clock),
    });
  }
}
