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
      const age = now().getTime() - Date.parse(cached?.timestamp || '');
      const fresh = cached?.stale !== true && Number.isFinite(age) && age >= -5000 && age <= 60000;
      const clock = { ...(cached || {}), is_open: fresh && cached?.is_open === true,
        stale: !fresh, available: Boolean(cached),
        ...(!fresh ? { staleReason: 'Broker clock unavailable or older than 60 seconds' } : {}) };
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
