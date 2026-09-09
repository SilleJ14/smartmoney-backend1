import test from 'node:test';
import assert from 'node:assert/strict';
import { getTodayKeyET, getEasternClock } from '../utils/time.js';

test('Eastern calendar handles midnight, market open, weekends and daylight saving', () => {
  for (const [utc, day, weekday, hour, minute] of [
    ['2026-09-09T04:00:00Z', '2026-09-09', 'Wed', 0, 0],
    ['2026-09-09T03:59:00Z', '2026-09-08', 'Tue', 23, 59],
    ['2026-09-09T13:30:00Z', '2026-09-09', 'Wed', 9, 30],
    ['2026-01-09T14:30:00Z', '2026-01-09', 'Fri', 9, 30],
    ['2026-03-08T06:59:00Z', '2026-03-08', 'Sun', 1, 59],
    ['2026-03-08T07:00:00Z', '2026-03-08', 'Sun', 3, 0],
    ['2026-11-01T05:30:00Z', '2026-11-01', 'Sun', 1, 30],
    ['2026-11-01T06:30:00Z', '2026-11-01', 'Sun', 1, 30],
  ]) {
    const date = new Date(utc);
    assert.equal(getTodayKeyET(date), day);
    assert.deepEqual(getEasternClock(date), { weekday, hour, minute });
  }
});

test('malformed persisted entry dates stay invalid without throwing or becoming today', () => {
  assert.equal(getTodayKeyET(new Date('malformed-entry')), 'Invalid Date');
  assert.notEqual(getTodayKeyET(new Date('malformed-entry')), getTodayKeyET());
});

test('per-quote Eastern clock calls do not allocate Intl formatters', () => {
  const Original = Intl.DateTimeFormat;
  let constructors = 0;
  Intl.DateTimeFormat = function (...args) { constructors++; return new Original(...args); };
  try {
    const date = new Date('2026-09-09T13:30:00Z');
    for (let i = 0; i < 1000; i++) { getTodayKeyET(date); getEasternClock(date); }
    assert.equal(constructors, 0);
  } finally { Intl.DateTimeFormat = Original; }
});
