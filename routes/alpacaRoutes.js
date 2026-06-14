export function registerAlpacaRoutes({
  app,
  requireAdmin,
  getAlpacaKeys,
  getTradingBaseUrl,
  fetchWithTimeout,
  getRuntimeAlpacaKeys,
  setRuntimeAlpacaKeys,
  saveRuntimeConfig,
}) {
  app.post("/alpaca-keys", requireAdmin, (req, res) => {
    const { liveKey, liveSecret } = req.body;

    const current = getRuntimeAlpacaKeys();

    const next = {
      liveKey: liveKey || current.liveKey,
      liveSecret: liveSecret || current.liveSecret,
    };

    setRuntimeAlpacaKeys(next);

    saveRuntimeConfig({
      alpacaLiveKey: next.liveKey,
      alpacaLiveSecret: next.liveSecret,
    });

    res.json({
      success: true,
      message: "Alpaca keys saved",
    });
  });

  app.get("/alpaca-keys-test", requireAdmin, (req, res) => {
    res.json({
      ok: true,
      message: "Alpaca keys route is live",
    });
  });

  app.get("/alpaca/broker-positions", requireAdmin, async (req, res) => {
    try {
      const { key, secret } = getAlpacaKeys();

      if (!key || !secret) {
        return res.status(400).json({
          error: "Missing Alpaca keys",
        });
      }

      const response = await fetchWithTimeout(`${getTradingBaseUrl()}/v2/positions`, {
        headers: {
          "APCA-API-KEY-ID": key,
          "APCA-API-SECRET-KEY": secret,
        },
      });

      const text = await response.text();

      try {
        if (!response.ok) {
          return res.status(response.status).json({
            error: "Alpaca API error",
            details: text,
          });
        }

        const data = text ? JSON.parse(text) : [];

        return res.json({
          positions: Array.isArray(data) ? data : [],
        });
      } catch {
        return res.status(500).json({
          error: "Alpaca returned invalid JSON",
          raw: text.slice(0, 300),
        });
      }
    } catch (err) {
      return res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get("/alpaca/broker-orders", requireAdmin, async (req, res) => {
    try {
      const { key, secret } = getAlpacaKeys();

      if (!key || !secret) {
        return res.status(400).json({
          error: "Missing Alpaca keys",
        });
      }

      const response = await fetchWithTimeout(
        `${getTradingBaseUrl()}/v2/orders?status=all&limit=50`,
        {
          headers: {
            "APCA-API-KEY-ID": key,
            "APCA-API-SECRET-KEY": secret,
          },
        }
      );

      const text = await response.text();

      try {
        if (!response.ok) {
          return res.status(response.status).json({
            error: "Alpaca API error",
            details: text,
          });
        }

        const data = text ? JSON.parse(text) : [];

        return res.json({
          orders: Array.isArray(data) ? data : [],
        });
      } catch {
        return res.status(500).json({
          error: "Alpaca returned invalid JSON",
          raw: text.slice(0, 300),
        });
      }
    } catch (err) {
      return res.status(500).json({
        error: err.message,
      });
    }
  });
}