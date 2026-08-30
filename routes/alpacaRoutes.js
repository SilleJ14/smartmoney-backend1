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
  const portfolioHistoryCache = new Map();
  const portfolioHistoryRanges = {
    LIVE: { period: "1D", timeframe: "5Min", ttlMs: 15_000 },
    "1D": { period: "1D", timeframe: "5Min", ttlMs: 30_000 },
    "1W": { period: "1W", timeframe: "15Min", ttlMs: 60_000 },
    "1M": { period: "1M", timeframe: "1D", ttlMs: 5 * 60_000 },
    "3M": { period: "3M", timeframe: "1D", ttlMs: 5 * 60_000 },
    "1Y": { period: "1A", timeframe: "1D", ttlMs: 15 * 60_000 },
    ALL: { start: "2000-01-01T00:00:00Z", timeframe: "1D", ttlMs: 15 * 60_000 },
  };

  const normalizePortfolioHistory = (payload = {}, range) => {
    const timestamps = Array.isArray(payload.timestamp) ? payload.timestamp : [];
    const equity = Array.isArray(payload.equity) ? payload.equity : [];
    const profitLoss = Array.isArray(payload.profit_loss) ? payload.profit_loss : [];
    const profitLossPercent = Array.isArray(payload.profit_loss_pct) ? payload.profit_loss_pct : [];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const points = [];

    for (let index = 0; index < Math.min(timestamps.length, equity.length, 10_000); index += 1) {
      const timestamp = Number(timestamps[index]);
      const value = Number(equity[index]);
      if (!Number.isFinite(timestamp) || !Number.isFinite(value) || value <= 0) continue;
      if (timestamp <= 0 || timestamp > nowSeconds + 300) continue;
      points.push({ timestamp, value, sourceIndex: index });
    }

    points.sort((a, b) => a.timestamp - b.timestamp);
    const step = Math.max(1, Math.ceil(points.length / 720));
    const bounded = points.filter((_, index) => index % step === 0);
    const lastPoint = points.at(-1);
    if (lastPoint && bounded.at(-1)?.timestamp !== lastPoint.timestamp) bounded.push(lastPoint);

    const lastIndex = lastPoint?.sourceIndex ?? -1;
    const reportedDollars = Number(profitLoss[lastIndex]);
    const reportedPercent = Number(profitLossPercent[lastIndex]);
    const firstValue = bounded[0]?.value;
    const lastValue = bounded.at(-1)?.value;
    const fallbackDollars = Number.isFinite(firstValue) && Number.isFinite(lastValue) ? lastValue - firstValue : 0;
    const fallbackPercent = Number.isFinite(firstValue) && firstValue > 0 ? (fallbackDollars / firstValue) * 100 : 0;

    return {
      ok: true,
      range,
      points: bounded.map(({ timestamp, value }) => ({ timestamp, value })),
      changeDollars: Number.isFinite(reportedDollars) ? reportedDollars : fallbackDollars,
      changePercent: Number.isFinite(reportedPercent)
        ? (Math.abs(reportedPercent) <= 5 ? reportedPercent * 100 : reportedPercent)
        : fallbackPercent,
      baseValue: Number(payload.base_value) || firstValue || 0,
      timeframe: String(payload.timeframe || portfolioHistoryRanges[range]?.timeframe || ""),
      fetchedAt: new Date().toISOString(),
    };
  };

  app.post("/alpaca-keys", requireAdmin, (req, res) => {
    const { liveKey, liveSecret } = req.body;

    const current = getRuntimeAlpacaKeys();

    const next = {
      liveKey: liveKey || current.liveKey,
      liveSecret: liveSecret || current.liveSecret,
    };

    setRuntimeAlpacaKeys(next);
    portfolioHistoryCache.clear();

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

  app.get("/alpaca/portfolio-history", requireAdmin, async (req, res) => {
    const range = String(req.query?.range || "LIVE").trim().toUpperCase();
    const rangeConfig = portfolioHistoryRanges[range];
    if (!rangeConfig) {
      return res.status(400).json({ error: "Unsupported portfolio history range" });
    }

    const cached = portfolioHistoryCache.get(range);
    if (cached && Date.now() - cached.cachedAt < rangeConfig.ttlMs) {
      return res.json(cached.payload);
    }

    try {
      const { key, secret } = getAlpacaKeys();
      if (!key || !secret) return res.status(400).json({ error: "Missing Alpaca keys" });

      const query = new URLSearchParams({ timeframe: rangeConfig.timeframe });
      if (rangeConfig.period) query.set("period", rangeConfig.period);
      if (rangeConfig.start) query.set("start", rangeConfig.start);
      if (rangeConfig.timeframe !== "1D") query.set("intraday_reporting", "continuous");

      const response = await fetchWithTimeout(
        `${getTradingBaseUrl()}/v2/account/portfolio/history?${query.toString()}`,
        {
          headers: {
            "APCA-API-KEY-ID": key,
            "APCA-API-SECRET-KEY": secret,
          },
        }
      );
      const text = await response.text();
      if (!response.ok) {
        return res.status(response.status).json({
          error: "Alpaca portfolio history error",
          details: text.slice(0, 300),
        });
      }

      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        return res.status(502).json({ error: "Alpaca returned invalid portfolio history" });
      }

      const payload = normalizePortfolioHistory(data, range);
      portfolioHistoryCache.set(range, { cachedAt: Date.now(), payload });
      while (portfolioHistoryCache.size > Object.keys(portfolioHistoryRanges).length) {
        portfolioHistoryCache.delete(portfolioHistoryCache.keys().next().value);
      }
      return res.json(payload);
    } catch (err) {
      return res.status(500).json({ error: err.message || "Portfolio history request failed" });
    }
  });
}
