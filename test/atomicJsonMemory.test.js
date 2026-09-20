import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from '../state/safeJson.js';

test('chunked atomic persistence preserves large snapshots and split Unicode', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartmoney-atomic-json-'));
  try {
    const target = path.join(dir, 'state.json');
    // JSON prefix is 9 UTF-16 units; put a surrogate pair across 64 KB.
    const state = { text: 'a'.repeat(65526) + '🚀' + '€'.repeat(200000),
      locks: { emergencyStop: true }, unresolved: [{ clientOrderId: 'stable-id', state: 'UNKNOWN' }] };
    await writeJsonAtomic(target, state);
    assert.equal(await fs.readFile(target, 'utf8'), JSON.stringify(state));
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), state);
    await writeJsonAtomic(target, { locks: state.locks });
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { locks: state.locks });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('a failed chunk write never replaces the previous durable state', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartmoney-atomic-failure-'));
  const target = path.join(dir, 'state.json');
  const previous = { emergencyStop: true, pendingOrder: 'must-reconcile' };
  try {
    await writeJsonAtomic(target, previous);
    const open = fs.open.bind(fs);
    t.mock.method(fs, 'open', async (...args) => {
      const handle = await open(...args);
      if (args[0] !== `${target}.tmp`) return handle;
      return { write: async () => { throw new Error('simulated disk failure'); }, close: () => handle.close() };
    });
    await assert.rejects(writeJsonAtomic(target, { emergencyStop: false }), /simulated disk failure/);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), previous);
  } finally { t.mock.restoreAll(); await fs.rm(dir, { recursive: true, force: true }); }
});
