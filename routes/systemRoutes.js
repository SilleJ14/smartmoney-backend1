const BACKEND_RELEASE_ID = "scoring-telemetry-2026-08-25";

function getBackendRelease() {
  return {
    id: BACKEND_RELEASE_ID,
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
  };
}

export function registerSystemRoutes(app, dependencies) {
  const {
    requireAdmin, getSystemSnapshot, getInfrastructureSnapshot,
    getClock, getHealthPayload, getFallbackMarketOpen, getEngineRuntime,
    now = () => new Date(),
  } = dependencies;

  app.get("/", requireAdmin, (_req, res) => res.json(getSystemSnapshot()));
  app.get("/infra-status", requireAdmin, (_req, res) => {
    res.json({ ...getInfrastructureSnapshot(), savedAt: now().toISOString() });
  });
  app.get("/health", async (_req, res) => {
    try {
      const clock = await getClock().catch((error) => ({
        is_open: Boolean(getFallbackMarketOpen()), error: error.message,
      }));
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
