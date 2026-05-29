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
    expect(automotive?.eventPortal).toMatchObject({
      enabled: false,
      baseUrl: "https://api.solace.cloud",
      tokenEnv: "EVENT_PORTAL_API_TOKEN",
      syncMode: "metadata-only"
    });
    expect(automotive?.aiAssistant).toMatchObject({
      enabled: false,
      baseUrl: "http://localhost:4000",
      apiKeyEnv: "LITELLM_API_KEY",
      model: "gpt-4o-mini"
    });
    const { brokersFile, catalog } = scenarioToFiles(automotive!);
    expect(brokersFile.brokers).toHaveLength(10);
    expect(catalog.applications.filter((app) => app.role === "emitter")).toHaveLength(15);
    expect(catalog.applications.filter((app) => app.role === "listener")).toHaveLength(5);
  });

  it("keeps routes to one source broker, at most one broker hop, and one subscribed broker", async () => {
    const config = await loadTopologyConfig(path.resolve(process.cwd(), "../../config/topology.yaml"));
    for (const scenario of config.scenarios) {
      const publishers = scenario.applications.filter((app) => app.role === "emitter" || app.role === "both");
      const directBrokerLinks = new Set(scenario.links.map((link) => `${link.from}->${link.to}`));
      expect(publishers.every((app) => app.brokerIds.length === 1), scenario.id).toBe(true);

      for (const subscriber of scenario.applications.filter((app) => app.role === "listener" || app.role === "both")) {
        const topics = subscriber.listen?.topicPrefixes ?? [];
        expect(subscriber.brokerIds.length, `${scenario.id}:${subscriber.id}`).toBe(1);
        expect(topics.length, `${scenario.id}:${subscriber.id}`).toBeGreaterThan(0);
        const subscriberBroker = subscriber.brokerIds[0];

        for (const topic of topics) {
          const matchingPublishers = publishers.filter((publisher) => publisher.publishTopicPrefixes?.some((publisherTopic) => topicPatternsOverlap(publisherTopic, topic)));
          expect(matchingPublishers.length, `${scenario.id}:${subscriber.id}:${topic}`).toBeGreaterThan(0);

          for (const publisher of matchingPublishers) {
            const publisherBroker = publisher.brokerIds[0];
            expect(
              publisherBroker === subscriberBroker || directBrokerLinks.has(`${publisherBroker}->${subscriberBroker}`),
              `${scenario.id}:${publisher.id}->${subscriber.id}:${publisherBroker}->${subscriberBroker}`
            ).toBe(true);
          }
        }
      }
    }
  });
});
