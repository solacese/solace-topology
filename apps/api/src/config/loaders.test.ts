import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadTopologyConfig, scenarioToFiles } from "./loaders.js";
import { matchesAnyPattern } from "@solace-topology/shared";

function topicStem(pattern: string): string {
  const wildcardIndex = pattern.search(/[+>]/);
  return (wildcardIndex >= 0 ? pattern.slice(0, wildcardIndex) : pattern).replace(/\/$/, "");
}

function topicPatternsOverlap(left: string, right: string): boolean {
  if (left === right || left === ">" || right === ">") {
    return true;
  }
  return matchesAnyPattern(left, [right]) || matchesAnyPattern(right, [left]) || topicStem(left).startsWith(topicStem(right)) || topicStem(right).startsWith(topicStem(left));
}

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
    expect(brokersFile.brokers).toHaveLength(10);
    expect(catalog.applications.filter((app) => app.role === "emitter")).toHaveLength(15);
    expect(catalog.applications.filter((app) => app.role === "listener")).toHaveLength(5);
  });

  it("keeps every publisher on one broker and every subscriber matched to a publisher", async () => {
    const config = await loadTopologyConfig(path.resolve(process.cwd(), "../../config/topology.yaml"));
    for (const scenario of config.scenarios) {
      const publishers = scenario.applications.filter((app) => app.role === "emitter" || app.role === "both");
      const publisherTopics = publishers.flatMap((app) => app.publishTopicPrefixes ?? []);
      expect(publishers.every((app) => app.brokerIds.length === 1), scenario.id).toBe(true);

      for (const subscriber of scenario.applications.filter((app) => app.role === "listener" || app.role === "both")) {
        const topics = subscriber.listen?.topicPrefixes ?? [];
        expect(topics.length, `${scenario.id}:${subscriber.id}`).toBeGreaterThan(0);
        expect(
          topics.some((topic) => publisherTopics.some((publisherTopic) => topicPatternsOverlap(publisherTopic, topic))),
          `${scenario.id}:${subscriber.id}`
        ).toBe(true);
      }
    }
  });
});
