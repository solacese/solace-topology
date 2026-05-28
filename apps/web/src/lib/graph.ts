import { matchesAnyPattern, type TopologyEdge, type TopologyNode, type TopologySnapshot } from "@solace-topology/shared";

export interface GraphFilters {
  search: string;
  provenances: Set<string>;
}

export interface StructuredLink {
  id: string;
  source: string;
  target: string;
  kind: "emit" | "listen" | "mesh";
  msgRate: number;
}

export interface StructuredTopology {
  emitters: TopologyNode[];
  brokers: TopologyNode[];
  listeners: TopologyNode[];
  links: StructuredLink[];
}

function isApplication(node: TopologyNode): boolean {
  return node.type === "Application";
}

function roleOf(node: TopologyNode): string {
  return String(node.metadata?.role ?? "");
}

function nodeMatchesSearch(node: TopologyNode, query: string): boolean {
  if (!query) {
    return true;
  }
  const text = `${node.label} ${node.type} ${Object.values(node.metadata ?? {}).join(" ")}`.toLowerCase();
  return text.includes(query);
}

function nodeMatchesProvenance(node: TopologyNode, provenances: Set<string>): boolean {
  if (provenances.size === 0 || !isApplication(node)) {
    return true;
  }
  return provenances.has(String(node.metadata?.provenance ?? ""));
}

function brokerIdsFromMetadata(node: TopologyNode): string[] {
  const brokerIds = node.metadata?.brokerIds;
  if (Array.isArray(brokerIds)) {
    return brokerIds.map(String);
  }
  if (typeof brokerIds === "string") {
    return brokerIds.split(",").map((brokerId) => brokerId.trim()).filter(Boolean);
  }
  return [];
}

function brokerIdsFromEdges(node: TopologyNode, edges: TopologyEdge[]): string[] {
  return edges
    .filter((edge) => edge.type === "CONNECTED_TO" && edge.source === node.id && edge.target.startsWith("vpn:"))
    .map((edge) => edge.target.split(":")[1])
    .filter((brokerId): brokerId is string => Boolean(brokerId));
}

function brokerIdsForApp(node: TopologyNode, edges: TopologyEdge[]): string[] {
  const brokerIds = brokerIdsFromMetadata(node);
  return brokerIds.length > 0 ? brokerIds : brokerIdsFromEdges(node, edges);
}

function sortByLabel<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label));
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

function nodeById(snapshot: TopologySnapshot, id: string): TopologyNode | undefined {
  return snapshot.nodes.find((node) => node.id === id);
}

function publishedTopics(snapshot: TopologySnapshot, appId: string): string[] {
  return snapshot.edges
    .filter((edge) => edge.type === "PUBLISHES_TO" && edge.source === appId)
    .map((edge) => nodeById(snapshot, edge.target)?.label)
    .filter((value): value is string => Boolean(value));
}

function listenerTopics(snapshot: TopologySnapshot, appId: string): string[] {
  const queueIds = snapshot.edges.filter((edge) => edge.type === "CONSUMES_FROM" && edge.source === appId).map((edge) => edge.target);
  return snapshot.edges
    .filter((edge) => edge.type === "SUBSCRIBES_TO" && queueIds.includes(edge.source))
    .map((edge) => nodeById(snapshot, edge.target)?.label)
    .filter((value): value is string => Boolean(value));
}

export function relatedApplicationIds(snapshot: TopologySnapshot, selectedId: string | undefined): Set<string> {
  if (!selectedId) {
    return new Set();
  }
  const selected = nodeById(snapshot, selectedId);
  if (!selected || selected.type !== "Application") {
    return new Set([selectedId]);
  }

  const role = roleOf(selected);
  const related = new Set([selectedId]);
  if (role === "emitter" || role === "both") {
    const sourceTopics = publishedTopics(snapshot, selectedId);
    for (const listener of snapshot.nodes.filter((node) => node.type === "Application" && ["listener", "both"].includes(roleOf(node)))) {
      if (listenerTopics(snapshot, listener.id).some((topic) => sourceTopics.some((sourceTopic) => topicPatternsOverlap(sourceTopic, topic)))) {
        related.add(listener.id);
      }
    }
  }

  if (role === "listener" || role === "both") {
    const topics = listenerTopics(snapshot, selectedId);
    for (const emitter of snapshot.nodes.filter((node) => node.type === "Application" && ["emitter", "both"].includes(roleOf(node)))) {
      if (publishedTopics(snapshot, emitter.id).some((sourceTopic) => topics.some((topic) => topicPatternsOverlap(sourceTopic, topic)))) {
        related.add(emitter.id);
      }
    }
  }

  return related;
}

export function relatedBrokerIds(snapshot: TopologySnapshot, selectedId: string | undefined): Set<string> {
  if (!selectedId) {
    return new Set();
  }
  const selected = nodeById(snapshot, selectedId);
  if (!selected || selected.type !== "Application") {
    return new Set(selectedId.startsWith("broker:") ? [selectedId.replace(/^broker:/, "")] : []);
  }
  const relatedApps = relatedApplicationIds(snapshot, selectedId);
  const selectedBrokers = brokerIdsForApp(selected, snapshot.edges);
  const oppositeBrokers = snapshot.nodes
    .filter((node) => relatedApps.has(node.id) && node.id !== selectedId)
    .flatMap((node) => brokerIdsForApp(node, snapshot.edges));
  return new Set([...selectedBrokers, ...oppositeBrokers]);
}

export function activeRouteNodeIds(snapshot: TopologySnapshot, selectedId: string | undefined): Set<string> {
  if (!selectedId) {
    return new Set();
  }
  const selected = nodeById(snapshot, selectedId);
  if (!selected) {
    return new Set();
  }
  if (selected.type === "Broker") {
    const brokerId = selected.id.replace(/^broker:/, "");
    const active = new Set([selected.id]);
    for (const app of snapshot.nodes.filter((node) => node.type === "Application")) {
      if (brokerIdsForApp(app, snapshot.edges).includes(brokerId)) {
        active.add(app.id);
      }
    }
    for (const route of publisherSubscriberRoutes(snapshot).filter((route) => route.from === brokerId || route.to === brokerId)) {
      active.add(route.publisherId);
      active.add(route.subscriberId);
      active.add(`broker:${route.from}`);
      active.add(`broker:${route.to}`);
    }
    return active;
  }
  if (selected.type === "Application") {
    const active = new Set<string>();
    for (const appId of relatedApplicationIds(snapshot, selectedId)) {
      active.add(appId);
    }
    for (const brokerId of relatedBrokerIds(snapshot, selectedId)) {
      active.add(`broker:${brokerId}`);
    }
    return active;
  }
  return new Set([selected.id]);
}

function publisherSubscriberRoutes(snapshot: TopologySnapshot): Array<{ publisherId: string; subscriberId: string; from: string; to: string; msgRate: number }> {
  const routes: Array<{ publisherId: string; subscriberId: string; from: string; to: string; msgRate: number }> = [];
  const emitters = snapshot.nodes.filter((node) => node.type === "Application" && ["emitter", "both"].includes(roleOf(node)));
  const listeners = snapshot.nodes.filter((node) => node.type === "Application" && ["listener", "both"].includes(roleOf(node)));

  for (const emitter of emitters) {
    const sourceTopics = publishedTopics(snapshot, emitter.id);
    const sourceBrokers = brokerIdsForApp(emitter, snapshot.edges);
    const msgRate = emitter.metrics?.msgRate ?? 0;
    for (const listener of listeners) {
      const targetTopics = listenerTopics(snapshot, listener.id);
      if (!sourceTopics.some((sourceTopic) => targetTopics.some((targetTopic) => topicPatternsOverlap(sourceTopic, targetTopic)))) {
        continue;
      }
      for (const from of sourceBrokers) {
        for (const to of brokerIdsForApp(listener, snapshot.edges)) {
          routes.push({ publisherId: emitter.id, subscriberId: listener.id, from, to, msgRate });
        }
      }
    }
  }

  return routes;
}

function meshRatesByBrokerPair(snapshot: TopologySnapshot): Map<string, number> {
  const rates = new Map<string, number>();
  const seenForwardedPublishers = new Set<string>();
  for (const route of publisherSubscriberRoutes(snapshot)) {
    if (route.from === route.to) {
      continue;
    }
    const seenKey = `${route.publisherId}:${route.from}->${route.to}`;
    if (seenForwardedPublishers.has(seenKey)) {
      continue;
    }
    seenForwardedPublishers.add(seenKey);
    const linkKey = `${route.from}->${route.to}`;
    rates.set(linkKey, (rates.get(linkKey) ?? 0) + route.msgRate);
  }
  return rates;
}

export function brokerRouteOffsets(snapshot: TopologySnapshot, selectedId: string | undefined): Map<string, number> {
  if (!selectedId) {
    return new Map();
  }
  const selected = nodeById(snapshot, selectedId);
  if (!selected) {
    return new Map();
  }

  let pairs: Array<{ from: string; to: string }> = [];
  const routes = publisherSubscriberRoutes(snapshot);

  if (selected.type === "Application") {
    pairs = routes.filter((route) => route.publisherId === selectedId || route.subscriberId === selectedId).map((route) => ({ from: route.from, to: route.to }));
  }

  if (selected.type === "Broker") {
    const brokerId = selected.id.replace(/^broker:/, "");
    pairs = routes.filter((route) => route.from === brokerId || route.to === brokerId).map((route) => ({ from: route.from, to: route.to }));
  }

  const positions = new Map<string, number[]>();
  for (const pair of pairs) {
    if (pair.from === pair.to) {
      positions.set(pair.from, [...(positions.get(pair.from) ?? []), 0]);
      continue;
    }
    positions.set(pair.from, [...(positions.get(pair.from) ?? []), -1]);
    positions.set(pair.to, [...(positions.get(pair.to) ?? []), 1]);
  }

  const offsets = new Map<string, number>();
  for (const [brokerId, values] of positions) {
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    offsets.set(`broker:${brokerId}`, Math.round(average * 26));
  }
  return offsets;
}

export function buildStructuredTopology(snapshot: TopologySnapshot, filters: GraphFilters): StructuredTopology {
  const query = filters.search.trim().toLowerCase();
  const applicationNodes = snapshot.nodes.filter(isApplication).filter((node) => nodeMatchesSearch(node, query)).filter((node) => nodeMatchesProvenance(node, filters.provenances));
  const emitters = sortByLabel(applicationNodes.filter((node) => roleOf(node) === "emitter" || roleOf(node) === "both"));
  const listeners = sortByLabel(applicationNodes.filter((node) => roleOf(node) === "listener" || roleOf(node) === "both"));
  const brokerNodes = snapshot.nodes.filter((node) => node.type === "Broker");
  const explicitBrokerMatches = query ? brokerNodes.filter((node) => nodeMatchesSearch(node, query)) : brokerNodes;
  const connectedBrokerIds = new Set<string>();

  for (const app of [...emitters, ...listeners]) {
    for (const brokerId of brokerIdsForApp(app, snapshot.edges)) {
      connectedBrokerIds.add(`broker:${brokerId}`);
    }
  }

  const brokers = sortByLabel(
    brokerNodes.filter((broker) => {
      if (!query) {
        return true;
      }
      return connectedBrokerIds.has(broker.id) || explicitBrokerMatches.some((match) => match.id === broker.id);
    })
  );
  const visibleBrokerIds = new Set(brokers.map((broker) => broker.id.replace(/^broker:/, "")));
  const meshRates = meshRatesByBrokerPair(snapshot);

  const links: StructuredLink[] = [];
  for (const emitter of emitters) {
    for (const brokerId of brokerIdsForApp(emitter, snapshot.edges)) {
      if (!visibleBrokerIds.has(brokerId)) {
        continue;
      }
      links.push({
        id: `emit:${emitter.id}->broker:${brokerId}`,
        source: emitter.id,
        target: `broker:${brokerId}`,
        kind: "emit",
        msgRate: emitter.metrics?.msgRate ?? 0
      });
    }
  }
  for (const listener of listeners) {
    for (const brokerId of brokerIdsForApp(listener, snapshot.edges)) {
      if (!visibleBrokerIds.has(brokerId)) {
        continue;
      }
      links.push({
        id: `listen:broker:${brokerId}->${listener.id}`,
        source: `broker:${brokerId}`,
        target: listener.id,
        kind: "listen",
        msgRate: listener.metrics?.msgRate ?? 0
      });
    }
  }

  for (const edge of snapshot.edges.filter((item) => item.type === "LINKED_TO" && item.source.startsWith("broker:") && item.target.startsWith("broker:"))) {
    const sourceBrokerId = edge.source.replace(/^broker:/, "");
    const targetBrokerId = edge.target.replace(/^broker:/, "");
    if (!visibleBrokerIds.has(sourceBrokerId) || !visibleBrokerIds.has(targetBrokerId)) {
      continue;
    }
    const msgRate = meshRates.get(`${sourceBrokerId}->${targetBrokerId}`) ?? meshRates.get(`${targetBrokerId}->${sourceBrokerId}`) ?? edge.metrics?.msgRate ?? 0;
    links.push({
      id: `mesh:${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      kind: "mesh",
      msgRate
    });
  }

  return { emitters, brokers, listeners, links };
}

export function availableProvenances(snapshot: TopologySnapshot | undefined): string[] {
  if (!snapshot) {
    return [];
  }
  return [
    ...new Set(
      snapshot.nodes
        .filter((node) => node.type === "Application")
        .map((node) => String(node.metadata?.provenance ?? ""))
        .filter(Boolean)
    )
  ].sort();
}
