import { describe, expect, it } from "vitest";
import type { TopologyScenario, TopologySnapshot } from "@solace-topology/shared";
import { buildStaticSnapshot } from "./staticDemo.js";

const scenario: TopologyScenario = {
  id: "test",
  name: "Test",
  display: {
    title: "Solace Topology",
    subtitle: ""
  },
  owners: [{ id: "ops", displayName: "Operations" }],
  costCenters: [{ id: "iot", displayName: "IoT" }],
  brokers: [
    {
      id: "edge",
      displayName: "Edge Broker",
      managementUrl: "https://edge.example.com",
      messageVpns: ["default"],
      region: "Europe",
      site: "Plant A",
      physicalLocation: "Douai, France",
      environment: "demo",
      tlsRejectUnauthorized: true,
      tags: ["edge"]
    }
  ],
  links: [],
  applications: [
    {
      id: "publisher-a",
      displayName: "Publisher A",
      role: "emitter",
      provenance: "IoT",
      owner: "ops",
      costCenter: "iot",
      brokerIds: ["edge"],
      publishTopicPrefixes: ["data/iot/>"]
    }
  ]
};

function rate(snapshot: TopologySnapshot, nodeId: string): number {
  return snapshot.nodes.find((node) => node.id === nodeId)?.metrics?.msgRate ?? 0;
}

describe("static demo snapshot", () => {
  it("keeps throughput stable inside a bucket and changes it every 3 seconds", () => {
    const first = buildStaticSnapshot(scenario, 0);
    const sameBucket = buildStaticSnapshot(scenario, 2_999);
    const nextBucket = buildStaticSnapshot(scenario, 3_000);

    expect(rate(first, "app:publisher-a")).toBeGreaterThan(0);
    expect(rate(first, "app:publisher-a")).toBe(rate(sameBucket, "app:publisher-a"));
    expect(rate(nextBucket, "app:publisher-a")).not.toBe(rate(first, "app:publisher-a"));
  });
});
