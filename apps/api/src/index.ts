import { createServer } from "node:http";
import { loadRuntimeConfig } from "./config/env.js";
import { TopologyService } from "./collector/topologyService.js";
import { createApp } from "./server/createApp.js";

const config = loadRuntimeConfig();
const topologyService = new TopologyService(config);
await topologyService.start();

const app = createApp(topologyService);
const server = createServer(app);

server.listen(config.port, () => {
  console.info(`Solace Topology API listening on http://localhost:${config.port}`);
});

async function shutdown(): Promise<void> {
  console.info("Shutting down Solace Topology API");
  await topologyService.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
