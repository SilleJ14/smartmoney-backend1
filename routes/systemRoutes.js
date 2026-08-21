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
      res.json(getHealthPayload(clock));
    } catch (error) {
      const engine = getEngineRuntime();
      res.status(500).json({
        ok: false, online: false, service: "SmartMoney Backend",
        error: error.message, generatedAt: now().toISOString(),
        engine: { running: Boolean(engine.running), crashed: true, lastError: error.message },
      });
    }
  });
}
