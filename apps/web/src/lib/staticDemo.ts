import type { BrokerConfig, CatalogFile, MetricBag, ScenarioSummary, TopologyConfigFile, TopologyNode, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";

function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) % 100_000;
  }
  return value;
}

function rate(seed: string, min: number, max: number): number {
  return min + (hash(seed) % (max - min));
}

function addNode(nodes: Map<string, TopologyNode>, node: TopologyNode): void {
  const previous = nodes.get(node.id);
  if (!previous) {
    nodes.set(node.id, node);
    return;
  }
  nodes.set(node.id, {
    ...previous,
    metrics: {
      ...previous.metrics,
      msgRate: (previous.metrics?.msgRate ?? 0) + (node.metrics?.msgRate ?? 0),
      byteRate: (previous.metrics?.byteRate ?? 0) + (node.metrics?.byteRate ?? 0)
    },
    metadata: {
      ...previous.metadata,
      ...node.metadata
    }
  });
}

function summary(scenario: TopologyScenario, nodes: TopologyNode[], catalog: CatalogFile) {
  const apps = nodes.filter((node) => node.type === "Application");
  const totalMsgRate = apps.reduce((sum, node) => sum + (node.metrics?.msgRate ?? 0), 0);
  const groupBy = (key: "provenance" | "owner" | "costCenter") =>
    Object.values(
      apps.reduce<Record<string, { id: string; label: string; msgRate: number; byteRate: number; applicationCount: number }>>((groups, node) => {
        const id = String(node.metadata?.[key] ?? "unknown");
        const owner = catalog.owners.find((item) => item.id === id)?.displayName;
        const costCenter = catalog.costCenters.find((item) => item.id === id)?.displayName;
        groups[id] ??= { id, label: owner ?? costCenter ?? id, msgRate: 0, byteRate: 0, applicationCount: 0 };
        groups[id].msgRate += node.metrics?.msgRate ?? 0;
        groups[id].byteRate += node.metrics?.byteRate ?? 0;
        groups[id].applicationCount += 1;
        return groups;
      }, {})
    );

  return {
    totalMsgRate,
    totalByteRate: apps.reduce((sum, node) => sum + (node.metrics?.byteRate ?? 0), 0),
    brokerCount: scenario.brokers.length,
    emittingApplicationCount: scenario.applications.filter((app) => app.role === "emitter" || app.role === "both").length,
    listeningApplicationCount: scenario.applications.filter((app) => app.role === "listener" || app.role === "both").length,
    byBroker: scenario.brokers.map((broker) => ({ id: broker.id, label: broker.displayName, msgRate: totalMsgRate / Math.max(scenario.brokers.length, 1), byteRate: 0, applicationCount: 0 })),
    byProvenance: groupBy("provenance"),
    byOwner: groupBy("owner"),
    byCostCenter: groupBy("costCenter")
  };
}

function brokerMetadata(broker: BrokerConfig): Record<string, string | string[]> {
  return {
    brokerId: broker.id,
    region: broker.region,
    site: broker.site,
    physicalLocation: broker.physicalLocation ?? broker.site,
    environment: broker.environment,
    tags: broker.tags
  };
}

export function scenarioSummaries(config: TopologyConfigFile): { activeScenarioId: string; scenarios: ScenarioSummary[] } {
  return {
    activeScenarioId: config.defaultScenario,
    scenarios: config.scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      title: scenario.display.title,
      subtitle: scenario.display.subtitle
    }))
  };
}

export function buildStaticSnapshot(scenario: TopologyScenario): TopologySnapshot {
  const nodes = new Map<string, TopologyNode>();
  const edges: TopologySnapshot["edges"] = [];

  for (const broker of scenario.brokers) {
    addNode(nodes, {
      id: `broker:${broker.id}`,
      type: "Broker",
      label: broker.displayName,
      status: "up",
      metrics: { msgRate: rate(broker.id, 700, 4_500), healthScore: 100 },
      metadata: brokerMetadata(broker)
    });
  }

  for (const link of scenario.links) {
    edges.push({
      id: `LINKED_TO:broker:${link.from}->broker:${link.to}:${link.kind}`,
      type: "LINKED_TO",
      source: `broker:${link.from}`,
      target: `broker:${link.to}`,
      label: link.kind,
      confidence: "declared"
    });
  }

  for (const app of scenario.applications) {
    const appRate = Math.max(1, app.role === "listener" ? rate(app.id, 80, 900) : rate(app.id, 160, 2_400));
    const metrics: MetricBag = { msgRate: appRate, byteRate: appRate * 720 };
    const appId = `app:${app.id}`;
    addNode(nodes, {
      id: appId,
      type: "Application",
      label: app.displayName,
      status: "up",
      metrics,
      metadata: {
        catalogId: app.id,
        role: app.role,
        provenance: app.provenance,
        owner: app.owner,
        costCenter: app.costCenter,
        brokerIds: app.brokerIds
      }
    });

    for (const brokerId of app.brokerIds) {
      edges.push({
        id: `CONNECTED_TO:${appId}->broker:${brokerId}`,
        type: "CONNECTED_TO",
        source: appId,
        target: `broker:${brokerId}`,
        label: "connects",
        confidence: "declared+observed",
        metrics
      });
    }

    for (const topic of app.publishTopicPrefixes ?? []) {
      const topicId = `topic:${topic}`;
      addNode(nodes, { id: topicId, type: "TopicPattern", label: topic, metrics, metadata: { direction: "publish" } });
      edges.push({ id: `PUBLISHES_TO:${appId}->${topicId}`, type: "PUBLISHES_TO", source: appId, target: topicId, label: "publishes", confidence: "declared+observed", metrics });
    }

    for (const queue of app.listen?.queues ?? []) {
      const queueId = `queue:${queue}`;
      addNode(nodes, { id: queueId, type: "Queue", label: queue, metrics, metadata: { queueName: queue } });
      edges.push({ id: `CONSUMES_FROM:${appId}->${queueId}`, type: "CONSUMES_FROM", source: appId, target: queueId, label: "consumes", confidence: "declared+observed", metrics });
      for (const topic of app.listen?.topicPrefixes ?? []) {
        const topicId = `topic:${topic}`;
        addNode(nodes, { id: topicId, type: "TopicPattern", label: topic, metadata: { direction: "subscribe" } });
        edges.push({ id: `SUBSCRIBES_TO:${queueId}->${topicId}`, type: "SUBSCRIBES_TO", source: queueId, target: topicId, label: "subscribes", confidence: "declared+observed", metrics });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "live",
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    title: scenario.display.title,
    subtitle: scenario.display.subtitle,
    nodes: [...nodes.values()],
    edges,
    brokerStatuses: scenario.brokers.map((broker) => ({
      brokerId: broker.id,
      displayName: broker.displayName,
      status: "connected",
      mode: "live",
      lastPollAt: new Date().toISOString()
    })),
    summary: summary(scenario, [...nodes.values()], scenario)
  };
}
