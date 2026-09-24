import test from 'node:test';
import assert from 'node:assert/strict';
import { recordForexAccountHistory } from '../forex/accountHistory.js';
test('forex NAV history samples real readings, bounds retention and isolates accounts', () => {
  const ledger = {}; const account = { id: 'fx-a', currency: 'USD', NAV: 1000 };
  const now = Date.parse('2026-09-23T15:00:00Z');
  assert.equal(recordForexAccountHistory(ledger, account, now).length, 1);
  assert.deepEqual(recordForexAccountHistory(ledger, { ...account, NAV: 1010 }, now + 1000), [{ timestamp: now + 1000, value: 1010 }]);
  assert.equal(recordForexAccountHistory(ledger, account, now + 60000).length, 2);
  for (let i = 2; i < 2000; i++) recordForexAccountHistory(ledger, account, now + i * 60000);
  assert.equal(ledger.forexAccountHistory.points.length, 1440);
  assert.equal(recordForexAccountHistory(ledger, { ...account, id: 'fx-b' }, now + 2000 * 60000).length, 1);
  assert.deepEqual(recordForexAccountHistory(ledger, { ...account, NAV: NaN }, now), []);
});
