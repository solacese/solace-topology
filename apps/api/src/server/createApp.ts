import cors from "cors";
import express from "express";
import type { TopologyService } from "../collector/topologyService.js";

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
