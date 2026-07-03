import cors from "cors";
import express from "express";
import type { TopologyService } from "../collector/topologyService.js";
import { buildSunburstTree, flattenForD3 } from "../history/sunburstBridge.js";

export function createApp(topologyService: TopologyService) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "solace-topology-api" });
  });

  app.get("/api/live", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const unsubscribe = topologyService.subscribe((snapshot) => {
      res.write(`event: snapshot\n`);
      res.write(`data: ${JSON.stringify({ type: "snapshot", snapshot })}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\n`);
      res.write(`data: {"ok":true}\n\n`);
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  app.get("/api/topology", (_req, res) => {
    res.json(topologyService.getSnapshot());
  });

  app.get("/api/scenarios", (_req, res) => {
    res.json(topologyService.getScenarioSummaries());
  });

  app.post("/api/scenarios/select", async (req, res, next) => {
    try {
      const scenarioId = typeof req.body?.scenarioId === "string" ? req.body.scenarioId : "";
      res.json(await topologyService.selectScenario(scenarioId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/config/scenario", (_req, res) => {
    res.json(topologyService.getActiveScenario());
  });

  app.put("/api/config/scenario", async (req, res, next) => {
    try {
      res.json(await topologyService.replaceActiveScenario(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/config/yaml", (_req, res) => {
    res.json({ scenarioId: topologyService.getActiveScenario().id, yaml: topologyService.getActiveScenarioYaml() });
  });

  app.put("/api/config/yaml", async (req, res, next) => {
    try {
      const yaml = typeof req.body?.yaml === "string" ? req.body.yaml : "";
      res.json(await topologyService.replaceActiveScenarioFromYaml(yaml));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/brokers/status", (_req, res) => {
    res.json({ brokers: topologyService.getSnapshot().brokerStatuses });
  });

  app.get("/api/catalog", (_req, res) => {
    res.json(topologyService.getCatalog());
  });

  app.get("/api/metrics/summary", (_req, res) => {
    res.json(topologyService.getSnapshot().summary);
  });

  app.get("/api/history", (req, res) => {
    const params = {
      scenarioId: typeof req.query.scenarioId === "string" ? req.query.scenarioId : undefined,
      since: typeof req.query.since === "string" ? req.query.since : undefined,
      until: typeof req.query.until === "string" ? req.query.until : undefined,
      limit: typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined,
      resolution: (typeof req.query.resolution === "string" ? req.query.resolution : "raw") as "raw" | "1m" | "5m" | "1h",
    };
    res.json({ points: topologyService.queryHistory(params), ...topologyService.getHistoryStats() });
  });

  app.get("/api/history/raw", (req, res) => {
    const params = {
      scenarioId: typeof req.query.scenarioId === "string" ? req.query.scenarioId : undefined,
      since: typeof req.query.since === "string" ? req.query.since : undefined,
      until: typeof req.query.until === "string" ? req.query.until : undefined,
      limit: typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 100,
    };
    res.json({ points: topologyService.queryHistoryRaw(params), ...topologyService.getHistoryStats() });
  });

  app.get("/api/sunburst/scan", (_req, res) => {
    const snapshot = topologyService.getSnapshot();
    const tree = buildSunburstTree(snapshot);
    res.json(tree);
  });

  app.get("/api/sunburst/d3", (req, res) => {
    const metric = req.query.metric === "topics" ? "topics" : "rate";
    const snapshot = topologyService.getSnapshot();
    const tree = buildSunburstTree(snapshot);
    res.json(flattenForD3(tree, metric as "rate" | "topics"));
  });

  app.post("/api/ai/mapping-suggestions", async (_req, res, next) => {
    try {
      res.json(await topologyService.suggestMappings());
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: (error as Error).message });
  });

  return app;
}
