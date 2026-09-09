import fs from 'node:fs';
import path from 'node:path';

// Small, local, allowlisted records only: no quotes, accounts, URLs, credentials,
// provider payloads or arbitrary exception messages. Fatal errors still terminate.
export function installProcessDiagnostics({ directory, processRef = process, logger = console,
  maxFileBytes = 128 * 1024, intervalMs = 15000 } = {}) {
  const file = path.join(directory, 'process.jsonl');
  const previous = path.join(directory, 'process.previous.jsonl');
  const budget = Math.max(4096, Math.min(128 * 1024, Number(maxFileBytes) || 128 * 1024));
  let getSnapshot = () => ({});
  let storageFailed = false;
  const finite = value => Number.isFinite(value) ? value : null;
  function record(event, error, exitCode) {
    try {
      const memory = processRef.memoryUsage();
      const snapshot = getSnapshot() || {};
      const phase = typeof snapshot.phase === 'string' && /^[A-Z0-9_ -]{1,80}$/.test(snapshot.phase)
        ? snapshot.phase : null;
      const row = {
        at: new Date().toISOString(), event, pid: processRef.pid,
        commit: /^[a-f0-9]{40}$/i.test(processRef.env?.RENDER_GIT_COMMIT || '') ? processRef.env.RENDER_GIT_COMMIT : null,
        node: processRef.version, uptimeSeconds: Math.round(processRef.uptime()),
        rssMB: Math.round(memory.rss / 1048576), heapMB: Math.round(memory.heapUsed / 1048576),
        phase, running: snapshot.running === true,
        stocks: finite(snapshot.stocks), crypto: finite(snapshot.crypto),
        exitCode: finite(exitCode),
        errorType: error ? (['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError'].includes(error.name) ? error.name : 'Error') : null,
        // Source file + line only; deliberately exclude message and URL query.
        frames: typeof error?.stack === 'string' ? error.stack.split('\n').slice(1, 7)
          .map(line => line.match(/([\w.-]+\.(?:js|mjs|cjs)):(\d+):(\d+)/)?.[0]).filter(Boolean) : [],
      };
      const line = JSON.stringify(row) + '\n';
      try {
        fs.mkdirSync(directory, { recursive: true });
        if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > budget) {
          // Only this module's two exact diagnostic files are rotated.
          if (fs.existsSync(previous)) fs.unlinkSync(previous);
          fs.renameSync(file, previous);
        }
        fs.appendFileSync(file, line, { mode: 0o600 });
      } catch {
        if (!storageFailed) logger.error('PROCESS_DIAGNOSTICS_STORAGE_UNAVAILABLE');
        storageFailed = true;
      }
      // Render retains stdout/stderr even if the instance's local disk vanishes.
      // One small allowlisted heartbeat per 15 seconds, never full engine state.
      logger.error('PROCESS_DIAGNOSTIC', line.trim());
    } catch { /* diagnostics must never take down the server */ }
  }
  const fatal = error => record('UNCAUGHT_EXCEPTION', error);
  const exit = code => record('EXIT', null, code);
  processRef.on('uncaughtExceptionMonitor', fatal);
  processRef.on('exit', exit);
  record('STARTUP');
  const timer = setInterval(() => record('HEARTBEAT'), Math.max(1000, intervalMs));
  timer.unref?.();
  return {
    record,
    setSnapshotReader(reader) { getSnapshot = reader; },
    dispose() { clearInterval(timer); processRef.off('uncaughtExceptionMonitor', fatal); processRef.off('exit', exit); },
  };
}
