// Local, isolated release validation. Never launches the production server or
// deploys; the integration fixture replaces providers and forbids order writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'memory-validation-results');
fs.mkdirSync(directory, { recursive: true });
const statusPath = path.join(directory, 'status.json');
function fingerprint() {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split('\0').filter(name => /\.(js|mjs|json)$/.test(name) &&
      !/^(node_modules|memory-validation-results|data|runtime-data)\//.test(name)).sort();
  const hash = createHash('sha256');
  for (const name of paths) {
    hash.update(name); hash.update('\0');
    hash.update(fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name)) : 'DELETED');
  }
  return hash.digest('hex');
}
const initialFingerprint = fingerprint();
const state = { startedAt: new Date().toISOString(), pid: process.pid, sourceFingerprint: initialFingerprint,
  nodeVersion: process.version, deploymentAllowed: false, stage: 'STARTING' };
const update = patch => {
  Object.assign(state, patch, { updatedAt: new Date().toISOString() });
  fs.writeFileSync(statusPath + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(statusPath + '.tmp', statusPath);
};
const cleanEnv = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
async function run(stage, args, extraEnv = {}) {
  if (fingerprint() !== initialFingerprint) throw new Error('SOURCE_CHANGED_RESTART_VALIDATION');
  update({ stage });
  const fd = fs.openSync(path.join(directory, `${stage.toLowerCase()}.log`), 'w');
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: root, env: { ...cleanEnv, ...extraEnv },
        windowsHide: true, stdio: ['ignore', fd, fd] });
      update({ childPid: child.pid });
      child.once('error', reject); child.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`${stage}_FAILED_EXIT_${code}`);
    if (fingerprint() !== initialFingerprint) throw new Error('SOURCE_CHANGED_RESTART_VALIDATION');
  } finally { fs.closeSync(fd); }
}
try {
  await run('REGRESSION', ['--test', '--test-concurrency=1']);
  // User-approved release policy: retain the six-minute maximum-feed load gate,
  // not an overnight run. Historical failure logs remain unchanged.
  await run('SOAK_6_MINUTES', ['--test', 'test/serverProcess.integration.test.js'], {
    SMARTMONEY_FIXTURE_POLYGON: 'healthy', SMARTMONEY_FIXTURE_LOAD: 'full',
    SMARTMONEY_SOAK_MS: String(6 * 60000), SMARTMONEY_FIXTURE_MEMORY_MB: '2048',
    SMARTMONEY_MAX_FEED: 'true',
    SMARTMONEY_FIXTURE_HEAP_MB: '1024', SMARTMONEY_FIXTURE_RSS_LIMIT_MB: '1536',
  });
  update({ stage: 'PASSED', completedAt: new Date().toISOString(),
    note: 'Local simulated-provider validation only; deployment and live verification remain separate.' });
} catch (error) {
  update({ stage: 'FAILED', error: error.message, completedAt: new Date().toISOString() });
  process.exitCode = 1;
}
