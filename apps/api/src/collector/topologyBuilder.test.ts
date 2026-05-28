import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadTopologyConfig, scenarioToFiles } from "../config/loaders.js";
import { buildSampleObservations } from "../sample/sampleData.js";
import { buildTopologySnapshot } from "./topologyBuilder.js";

describe("topology builder", () => {
  it("builds the automotive sample graph with declared and observed relationships", async () => {
    const config = await loadTopologyConfig(path.resolve(process.cwd(), "../../config/topology.yaml"));
    const scenario = config.scenarios.find((item) => item.id === "automotive")!;
    const { brokersFile: brokers, catalog } = scenarioToFiles(scenario);
    const snapshot = buildTopologySnapshot(brokers, catalog, buildSampleObservations(brokers, catalog), { scenarioId: scenario.id, scenarioName: scenario.name });

    expect(snapshot.mode).toBe("sample");
    expect(snapshot.scenarioId).toBe("automotive");
    expect(snapshot.nodes.filter((node) => node.type === "Broker")).toHaveLength(10);
    expect(snapshot.nodes.filter((node) => node.type === "Application")).toHaveLength(20);
    expect(snapshot.summary.emittingApplicationCount).toBe(15);
    expect(snapshot.summary.listeningApplicationCount).toBe(5);
    expect(snapshot.edges.some((edge) => edge.type === "PUBLISHES_TO" && edge.confidence === "declared+observed")).toBe(true);
  });
});
