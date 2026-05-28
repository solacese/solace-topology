import { describe, expect, it } from "vitest";
import type { TopologySnapshot } from "@solace-topology/shared";
import { buildStructuredTopology } from "./graph.js";

const snapshot: TopologySnapshot = {
  generatedAt: new Date(0).toISOString(),
  mode: "sample",
  scenarioId: "test",
  scenarioName: "Test",
  title: "Test",
  subtitle: "Test",
  brokerStatuses: [],
  summary: {
    totalMsgRate: 100,
    totalByteRate: 1000,
    brokerCount: 1,
    emittingApplicationCount: 1,
    listeningApplicationCount: 1,
    byBroker: [],
    byProvenance: [],
    byOwner: [],
    byCostCenter: []
  },
  nodes: [
    { id: "broker:a", type: "Broker", label: "Broker A" },
    { id: "app:emit", type: "Application", label: "Vehicle Gateway", metadata: { role: "emitter", provenance: "IoT", brokerIds: ["a"] }, metrics: { msgRate: 100 } },
    { id: "app:listen", type: "Application", label: "Analytics", metadata: { role: "listener", provenance: "Data", brokerIds: ["a"] }, metrics: { msgRate: 50 } },
    { id: "topic:vehicle/>", type: "TopicPattern", label: "vehicle/>" }
  ],
  edges: [{ id: "e1", type: "PUBLISHES_TO", source: "app:emit", target: "topic:vehicle/>", metrics: { msgRate: 100 } }]
};

describe("structured topology", () => {
  it("keeps only emitters, brokers, listeners", () => {
    const topology = buildStructuredTopology(snapshot, { search: "", provenances: new Set() });

    expect(topology.emitters.map((node) => node.id)).toEqual(["app:emit"]);
    expect(topology.brokers.map((node) => node.id)).toEqual(["broker:a"]);
    expect(topology.listeners.map((node) => node.id)).toEqual(["app:listen"]);
    expect(topology.links.map((link) => link.kind)).toEqual(["emit", "listen"]);
  });

  it("filters application provenance without exposing topic nodes", () => {
    const topology = buildStructuredTopology(snapshot, { search: "", provenances: new Set(["IoT"]) });

    expect(topology.emitters).toHaveLength(1);
    expect(topology.listeners).toHaveLength(0);
    expect(topology.brokers).toHaveLength(1);
  });
});
