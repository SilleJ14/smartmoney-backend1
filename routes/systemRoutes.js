import { clockSnapshot } from '../market-data/brokerClock.js';
const BACKEND_RELEASE_ID = "discovery-scoring-safety-2026-08-26";

function getBackendRelease() {
  return {
    id: BACKEND_RELEASE_ID,
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
  };
}

export function registerSystemRoutes(app, dependencies) {
  const {
    requireAdmin, getSystemSnapshot, getInfrastructureSnapshot,
    getCachedClock = () => null, getHealthPayload, getEngineRuntime,
    now = () => new Date(),
  } = dependencies;

  app.get("/", requireAdmin, (_req, res) => res.json(getSystemSnapshot()));
  app.get("/infra-status", requireAdmin, (_req, res) => {
    res.json({ ...getInfrastructureSnapshot(), savedAt: now().toISOString() });
  });
  // Liveness must never depend on a broker request. A provider outage should
  // degrade discovery, not cause the hosting platform to restart this process.
  app.get("/health", (_req, res) => {
    try {
      const cached = getCachedClock();
      const clock = clockSnapshot(cached, now().getTime());
      res.json({ ...getHealthPayload(clock), release: getBackendRelease() });
    } catch (error) {
      const engine = getEngineRuntime();
      res.status(500).json({
        ok: false, online: false, service: "SmartMoney Backend",
        error: error.message, generatedAt: now().toISOString(),
        release: getBackendRelease(),
        engine: { running: Boolean(engine.running), crashed: true, lastError: error.message },
      });
    }
  });
}
