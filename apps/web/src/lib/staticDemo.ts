import {
  matchesAnyPattern,
  type ApplicationCatalogEntry,
  type BrokerConfig,
  type CatalogFile,
  type MetricBag,
  type ScenarioSummary,
  type TopologyConfigFile,
  type TopologyNode,
  type TopologyScenario,
  type TopologySnapshot
} from "@solace-topology/shared";

function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) % 100_000;
  }
  return value;
}

function baselineRate(seed: string, min: number, max: number): number {
  return min + (hash(seed) % (max - min));
}

function bucketRandom(seed: string, bucket: number): number {
  let value = (hash(seed) + bucket * 2_654_435_761) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4_294_967_295;
}

function jitteredRate(seed: string, min: number, max: number, now: number): number {
  const baseline = baselineRate(seed, min, max);
  const bucket = Math.floor(now / 3_000);
  const normalized = bucketRandom(seed, bucket);
  const multiplier = 0.78 + normalized * 0.44;
  return Math.max(1, Math.round(Math.min(max, Math.max(min, baseline * multiplier))));
}

function metricsFor(msgRate: number): MetricBag {
  return { msgRate, byteRate: msgRate * 720 };
}

function roleCanPublish(app: ApplicationCatalogEntry): boolean {
  return app.role === "emitter" || app.role === "both";
}

function roleCanSubscribe(app: ApplicationCatalogEntry): boolean {
  return app.role === "listener" || app.role === "both";
}

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

function appsHaveTopicOverlap(publisher: ApplicationCatalogEntry, subscriber: ApplicationCatalogEntry): boolean {
  return (publisher.publishTopicPrefixes ?? []).some((publishedTopic) => (subscriber.listen?.topicPrefixes ?? []).some((subscribedTopic) => topicPatternsOverlap(publishedTopic, subscribedTopic)));
}

interface EventFlow {
  publisherId: string;
  subscriberId: string;
  fromBrokerId: string;
  toBrokerId: string;
  msgRate: number;
}

function buildRateModel(scenario: TopologyScenario, now: number): { appMetrics: Map<string, MetricBag>; brokerMetrics: Map<string, MetricBag>; linkMetrics: Map<string, MetricBag> } {
  const appMetrics = new Map<string, MetricBag>();
  const publisherRates = new Map<string, number>();
  const flows: EventFlow[] = [];

  for (const app of scenario.applications.filter(roleCanPublish)) {
    const msgRate = jitteredRate(app.id, 160, 2_400, now);
    publisherRates.set(app.id, msgRate);
    appMetrics.set(app.id, metricsFor(msgRate));
  }

  for (const publisher of scenario.applications.filter(roleCanPublish)) {
    const fromBrokerId = publisher.brokerIds[0];
    const msgRate = publisherRates.get(publisher.id) ?? 0;
    if (!fromBrokerId || msgRate <= 0) {
      continue;
    }
    for (const subscriber of scenario.applications.filter(roleCanSubscribe)) {
      const toBrokerId = subscriber.brokerIds[0];
      if (!toBrokerId || !appsHaveTopicOverlap(publisher, subscriber)) {
        continue;
      }
      flows.push({ publisherId: publisher.id, subscriberId: subscriber.id, fromBrokerId, toBrokerId, msgRate });
    }
  }

  for (const app of scenario.applications.filter(roleCanSubscribe)) {
    const subscriberMsgRate = flows.filter((flow) => flow.subscriberId === app.id).reduce((sum, flow) => sum + flow.msgRate, 0);
    const publisherMsgRate = publisherRates.get(app.id) ?? 0;
    appMetrics.set(app.id, metricsFor(publisherMsgRate + subscriberMsgRate));
  }

  const brokerIngressRates = new Map(scenario.brokers.map((broker) => [broker.id, 0]));
  const brokerEgressRates = new Map(scenario.brokers.map((broker) => [broker.id, 0]));
  for (const app of scenario.applications.filter(roleCanPublish)) {
    const brokerId = app.brokerIds[0];
    if (brokerId) {
      brokerIngressRates.set(brokerId, (brokerIngressRates.get(brokerId) ?? 0) + (publisherRates.get(app.id) ?? 0));
    }
  }
  for (const app of scenario.applications.filter(roleCanSubscribe)) {
    const brokerId = app.brokerIds[0];
    if (brokerId) {
      brokerEgressRates.set(brokerId, (brokerEgressRates.get(brokerId) ?? 0) + (appMetrics.get(app.id)?.msgRate ?? 0));
    }
  }

  const brokerMetrics = new Map(
    scenario.brokers.map((broker) => {
      const msgRate = Math.max(brokerIngressRates.get(broker.id) ?? 0, brokerEgressRates.get(broker.id) ?? 0);
      return [broker.id, { ...metricsFor(msgRate), healthScore: 100 }];
    })
  );
  const linkMsgRates = new Map<string, number>();
  const seenForwardedPublishers = new Set<string>();
  for (const flow of flows) {
    if (flow.fromBrokerId === flow.toBrokerId) {
      continue;
    }
    const seenKey = `${flow.publisherId}:${flow.fromBrokerId}->${flow.toBrokerId}`;
    if (seenForwardedPublishers.has(seenKey)) {
      continue;
    }
    seenForwardedPublishers.add(seenKey);
    const linkKey = `${flow.fromBrokerId}->${flow.toBrokerId}`;
    linkMsgRates.set(linkKey, (linkMsgRates.get(linkKey) ?? 0) + flow.msgRate);
  }

  const linkMetrics = new Map([...linkMsgRates].map(([linkKey, msgRate]) => [linkKey, metricsFor(msgRate)]));
  return { appMetrics, brokerMetrics, linkMetrics };
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

export function buildStaticSnapshot(scenario: TopologyScenario, now = Date.now()): TopologySnapshot {
  const nodes = new Map<string, TopologyNode>();
  const edges: TopologySnapshot["edges"] = [];
  const generatedAt = new Date(now).toISOString();
  const rates = buildRateModel(scenario, now);

  for (const broker of scenario.brokers) {
    addNode(nodes, {
      id: `broker:${broker.id}`,
      type: "Broker",
      label: broker.displayName,
      status: "up",
      metrics: rates.brokerMetrics.get(broker.id) ?? { msgRate: 0, byteRate: 0, healthScore: 100 },
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
      confidence: "declared",
      metrics: rates.linkMetrics.get(`${link.from}->${link.to}`) ?? rates.linkMetrics.get(`${link.to}->${link.from}`) ?? { msgRate: 0, byteRate: 0 }
    });
  }

  for (const app of scenario.applications) {
    const metrics = rates.appMetrics.get(app.id) ?? { msgRate: 0, byteRate: 0 };
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
    generatedAt,
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
      lastPollAt: generatedAt
    })),
    summary: summary(scenario, [...nodes.values()], scenario)
  };
}
