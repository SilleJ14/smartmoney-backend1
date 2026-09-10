import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdminAuth } from '../security/adminAuth.js';

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmoney-owner-email-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const deliveries = [];
  let timestamp = 1000;
  const options = { adminToken: 'fixture-secret', allowInitialSignup: false,
    userFile: path.join(directory, 'users.json'), recoveryOwnerEmail: 'Owner@example.com',
    now: () => timestamp, recoveryEmailSender: async delivery => { deliveries.push(delivery); }, ...overrides };
  const auth = createAdminAuth(options);
  const routes = new Map();
  auth.registerRoutes({ post(route, ...handlers) { routes.set(route, handlers.at(-1)); }, get() {} });
  const run = async (route, body, ip = 'fixture-ip') => {
    const res = { code: 200, headers: {}, status(code) { this.code = code; return this; },
      setHeader(key, value) { this.headers[key] = value; }, json(body) { this.body = body; return this; } };
    await routes.get(`/auth/${route}`)({ headers: {}, ip, body }, res);
    return res;
  };
  return { auth, run, deliveries, options, directory, advance: ms => { timestamp += ms; } };
}
const email = 'owner@example.com';
const resetBody = code => ({ email, code, newPassword: 'new-fixture-password' });

test('trusted email restores a missing owner only after verification; password survives restart', async t => {
  const f = fixture(t);
  const sent = await f.run('request-password-reset', { email });
  assert.equal(sent.code, 202);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].to, email);
  assert.match(f.deliveries[0].code, /^\d{8}$/);
  assert.equal(fs.existsSync(f.options.userFile), false);
  assert.equal('code' in sent.body, false);
  const unknown = await f.run('request-password-reset', { email: 'stranger@example.com' }, 'another-ip');
  assert.deepEqual(unknown.body, sent.body);
  assert.equal(f.deliveries.length, 1);
  const denied = await f.run('reset-password', { ...resetBody(f.deliveries[0].code), email: 'stranger@example.com' });
  assert.equal(denied.code, 401);
  const reset = await f.run('reset-password', resetBody(f.deliveries[0].code));
  assert.equal(reset.body.ok, true);
  assert.equal(f.auth.sessionUser(reset.body.token).email, email);
  assert.equal((await f.run('reset-password', resetBody(f.deliveries[0].code))).code, 401);
  assert.doesNotMatch(fs.readFileSync(f.options.userFile, 'utf8'), /new-fixture-password|restoringOwner/);
  const restarted = createAdminAuth(f.options);
  assert.equal(restarted.sessionUser(reset.body.token).email, email);
  let login;
  restarted.registerRoutes({ post(route, ...handlers) { if (route === '/auth/login') login = handlers.at(-1); }, get() {} });
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  login({ headers: {}, ip: 'restart', body: { email, password: 'new-fixture-password' } }, response);
  assert.equal(response.body.ok, true);
});

test('missing owner requires a trusted server setting; diagnostics expose no address', async t => {
  const f = fixture(t, { recoveryOwnerEmail: '' });
  assert.equal((await f.run('request-password-reset', { email })).code, 503);
  assert.equal(f.deliveries.length, 0);
  assert.deepEqual(f.auth.getRecoveryConfiguration(), { emailConfigured: true, ownerRecoveryConfigured: false });
});

test('configured fallback cannot replace an existing different owner', async t => {
  const f = fixture(t, { allowInitialSignup: true });
  await f.run('signup', { email: 'existing@example.com', password: 'existing-password' });
  await f.run('request-password-reset', { email });
  assert.equal(f.deliveries.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(f.options.userFile, 'utf8')).users[0].email, 'existing@example.com');
});

test('failed delivery reports failure and does not invalidate the previous code', async t => {
  let fail = false;
  const deliveries = [];
  const f = fixture(t, { recoveryEmailSender: async delivery => {
    if (fail) throw new Error('fixture provider unavailable');
    deliveries.push(delivery);
  } });
  await f.run('request-password-reset', { email });
  fail = true;
  const failed = await f.run('request-password-reset', { email });
  assert.equal(failed.code, 503);
  assert.equal((await f.run('reset-password', resetBody(deliveries[0].code))).body.ok, true);
});

test('overlapping requests dispatch only one email', async t => {
  let release;
  let count = 0;
  const f = fixture(t, { recoveryEmailSender: async () => { count++; await new Promise(resolve => { release = resolve; }); } });
  const first = f.run('request-password-reset', { email });
  assert.equal((await f.run('request-password-reset', { email })).code, 202);
  release();
  assert.equal((await first).code, 202);
  assert.equal(count, 1);
});

test('codes expire and five wrong guesses prevent use', async t => {
  const f = fixture(t);
  await f.run('request-password-reset', { email });
  f.advance(600001);
  assert.equal((await f.run('reset-password', resetBody(f.deliveries[0].code))).code, 401);
  await f.run('request-password-reset', { email });
  for (let i = 0; i < 5; i++) assert.equal((await f.run('reset-password', resetBody('wrong'))).code, 401);
  assert.equal((await f.run('reset-password', resetBody(f.deliveries[1].code))).code, 401);
});

test('request limit reports when to retry', async t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) await f.run('request-password-reset', { email });
  const result = await f.run('request-password-reset', { email });
  assert.equal(result.code, 429);
  assert.equal(result.body.retryAfterSeconds, 3600);
  assert.equal(result.headers['Retry-After'], '3600');
});

test('storage failure leaves the recovery code available for retry', async t => {
  const f = fixture(t);
  await f.run('request-password-reset', { email });
  // A directory at the file target reliably prevents rename on Windows and Linux.
  fs.mkdirSync(f.options.userFile);
  assert.equal((await f.run('reset-password', resetBody(f.deliveries[0].code))).code, 503);
  fs.rmdirSync(f.options.userFile);
  assert.equal((await f.run('reset-password', resetBody(f.deliveries[0].code))).body.ok, true);
});
