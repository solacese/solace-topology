import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadTopologyConfig, scenarioToFiles } from "./loaders.js";

describe("topology YAML loader", () => {
  it("loads five scenarios from the centralized config", async () => {
    const config = await loadTopologyConfig(path.resolve(process.cwd(), "../../config/topology.yaml"));
    expect(config.defaultScenario).toBe("automotive");
    expect(config.scenarios).toHaveLength(5);
  });

  it("loads and validates the automotive catalog", async () => {
    const config = await loadTopologyConfig(path.resolve(process.cwd(), "../../config/topology.yaml"));
    const automotive = config.scenarios.find((scenario) => scenario.id === "automotive");
    expect(automotive).toBeDefined();
    const { brokersFile, catalog } = scenarioToFiles(automotive!);
    expect(brokersFile.brokers).toHaveLength(4);
    expect(catalog.applications.filter((app) => app.role === "emitter")).toHaveLength(15);
    expect(catalog.applications.filter((app) => app.role === "listener")).toHaveLength(5);
  });
});
