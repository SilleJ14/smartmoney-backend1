import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedStreamReplay } from '../live/boundedStreamReplay.js';

test('SSE replay is bounded by bytes and count, with no retained mutable payload graph', () => {
  const replay = createBoundedStreamReplay({ maxEntries: 3, maxBytes: 50 });
  const event = { id: 'first', generatedAt: '2026-09-09T00:00:00Z', payload: { nested: 'old' } };
  replay.add(event, 'first');
  event.payload.nested = 'changed';
  assert.equal(replay.since()[0].message, 'first');
  assert.equal(replay.since()[0].payload, undefined);
  for (let i = 0; i < 1000; i++) replay.add({ id: String(i), generatedAt: '2026-09-09T01:00:00Z' }, 'x'.repeat(20));
  assert.deepEqual(replay.getStatus(), { count: 2, bytes: 40, maxEntries: 3, maxBytes: 50 });
  assert.equal(replay.add(event, '€'.repeat(20)), false);
  assert.equal(replay.getStatus().bytes, 40);
});

test('SSE replay resumes after an event id or timestamp, in chronological order', () => {
  const replay = createBoundedStreamReplay();
  for (let i = 0; i < 30; i++) replay.add({ id: `event_${i}`, generatedAt: new Date(10000 + i * 1000).toISOString() }, `event${i}`);
  assert.equal(replay.since().length, 25);
  assert.deepEqual(replay.since('event_27').map(row => row.message), ['event28', 'event29']);
  assert.deepEqual(replay.since(new Date(37000).toISOString()).map(row => row.message), ['event28', 'event29']);
  assert.deepEqual(replay.since('bad_cursor'), []);
});
