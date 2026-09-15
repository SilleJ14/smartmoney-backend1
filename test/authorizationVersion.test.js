import test from 'node:test';
import assert from 'node:assert/strict';
import { riskPolicyVersion, assertRiskPolicyVersion } from '../risk/authorizationVersion.js';

test('risk policy version changes for limits and locks but not secrets or display settings', () => {
  const version = riskPolicyVersion({ maxOpenTrades: 4 });
  assert.equal(version, riskPolicyVersion({ maxOpenTrades: 4, theme: 'gold', API_KEY: 'never included' }));
  assert.notEqual(version, riskPolicyVersion({ maxOpenTrades: 3 }));
  assert.notEqual(version, riskPolicyVersion({ maxOpenTrades: 4 }, { emergencyStopActive: true }));
  assert.doesNotThrow(() => assertRiskPolicyVersion(version, version));
  assert.throws(() => assertRiskPolicyVersion(null, version), /REASSESSMENT_REQUIRED/);
  assert.throws(() => assertRiskPolicyVersion(version, riskPolicyVersion({ maxOpenTrades: 3 })), /REASSESSMENT_REQUIRED/);
});
