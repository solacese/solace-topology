import { matchesAnyPattern, type TopologyEdge, type TopologyNode, type TopologySnapshot } from "@solace-topology/shared";

export interface GraphFilters {
  search: string;
  provenances: Set<string>;
}

export interface StructuredLink {
  id: string;
  source: string;
  target: string;
  kind: "emit" | "listen";
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
