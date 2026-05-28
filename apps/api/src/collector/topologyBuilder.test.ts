import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BrokersFile, CatalogFile } from "@solace-topology/shared";
import type { BrokerObservation } from "./types.js";
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

    const msgRate = (nodeId: string) => snapshot.nodes.find((node) => node.id === nodeId)?.metrics?.msgRate ?? 0;
    const digitalTwinSources = [
      "app:vehicle-telemetry-gateway",
      "app:battery-health-collector",
      "app:connected-vehicle-api",
      "app:paint-shop-sensors",
      "app:body-shop-robots",
      "app:assembly-line-plc",
      "app:quality-vision-inspection",
      "app:logistics-yard-scanner",
      "app:operational-data-publisher"
    ];
    const subscriberIds = [
      "app:manufacturing-analytics",
      "app:digital-twin-platform",
      "app:aftersales-data-hub",
      "app:plant-operations-control",
      "app:connected-vehicle-command-listener"
    ];

    expect(msgRate("app:digital-twin-platform")).toBe(digitalTwinSources.reduce((sum, nodeId) => sum + msgRate(nodeId), 0));
    expect(msgRate("broker:cloud-core")).toBe(subscriberIds.reduce((sum, nodeId) => sum + msgRate(nodeId), 0));
  });

  it("does not double count broker ingress and egress for the same event flow", () => {
    const brokers: BrokersFile = {
      brokers: [
        {
          id: "broker-a",
          displayName: "Broker A",
          managementUrl: "http://localhost:8080",
          messageVpns: ["default"],
          region: "local",
          site: "local",
          environment: "test",
          tlsRejectUnauthorized: false,
          tags: []
        }
      ],
      links: []
    };
    const catalog: CatalogFile = {
      display: { title: "Test", subtitle: "" },
      owners: [{ id: "ops", displayName: "Ops" }],
      costCenters: [{ id: "ops", displayName: "Ops" }],
      applications: []
    };
    const observations: BrokerObservation[] = [
      {
        brokerId: "broker-a",
        mode: "live",
        clients: [
          {
            brokerId: "broker-a",
            vpnName: "default",
            name: "publisher",
            connected: true,
            ingressMsgRate: 40,
            egressMsgRate: 0,
            ingressByteRate: 400,
            egressByteRate: 0
          },
          {
            brokerId: "broker-a",
            vpnName: "default",
            name: "subscriber",
            connected: true,
            ingressMsgRate: 0,
            egressMsgRate: 40,
            ingressByteRate: 0,
            egressByteRate: 400
          }
        ],
        queues: [],
        subscriptions: [],
        status: { brokerId: "broker-a", displayName: "Broker A", status: "connected", mode: "live" }
      }
    ];

    const snapshot = buildTopologySnapshot(brokers, catalog, observations, { scenarioId: "test", scenarioName: "Test" });

    expect(snapshot.nodes.find((node) => node.id === "broker:broker-a")?.metrics?.msgRate).toBe(40);
  });
});
