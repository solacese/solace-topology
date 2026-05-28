import { matchesAnyPattern, type TopologyEdge, type TopologyNode, type TopologySnapshot } from "@solace-topology/shared";

export interface DetailItem {
  title: string;
  detail: string;
}

export interface DetailSection {
  title: string;
  items: DetailItem[];
}

function nodeById(snapshot: TopologySnapshot, id: string): TopologyNode | undefined {
  return snapshot.nodes.find((node) => node.id === id);
}

function edgesFrom(snapshot: TopologySnapshot, source: string, type?: TopologyEdge["type"]): TopologyEdge[] {
  return snapshot.edges.filter((edge) => edge.source === source && (!type || edge.type === type));
}

function brokerIds(node: TopologyNode): string[] {
  const raw = node.metadata?.brokerIds;
  if (Array.isArray(raw)) {
    return raw.map(String);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((value) => value.trim()).filter(Boolean);
  }
  return [];
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

function queueSubscriptions(snapshot: TopologySnapshot, queueId: string): string[] {
  return edgesFrom(snapshot, queueId, "SUBSCRIBES_TO")
    .map((edge) => nodeById(snapshot, edge.target)?.label)
    .filter((value): value is string => Boolean(value));
}

function queuesForListener(snapshot: TopologySnapshot, listenerId: string): Array<{ queue: TopologyNode; topics: string[] }> {
  return edgesFrom(snapshot, listenerId, "CONSUMES_FROM")
    .map((edge) => nodeById(snapshot, edge.target))
    .filter((node): node is TopologyNode => Boolean(node))
    .map((queue) => ({ queue, topics: queueSubscriptions(snapshot, queue.id) }));
}

function brokerDetailItems(snapshot: TopologySnapshot, app: TopologyNode): DetailItem[] {
  return brokerIds(app).map((brokerId) => {
    const broker = nodeById(snapshot, `broker:${brokerId}`);
    return {
      title: broker?.label ?? brokerId,
      detail: String(broker?.metadata?.physicalLocation ?? broker?.metadata?.site ?? "Configured broker")
    };
  });
}

function publishedTopics(snapshot: TopologySnapshot, emitterId: string): string[] {
  return edgesFrom(snapshot, emitterId, "PUBLISHES_TO")
    .map((edge) => nodeById(snapshot, edge.target)?.label)
    .filter((value): value is string => Boolean(value));
}

function sourceEmittersForListener(snapshot: TopologySnapshot, listener: TopologyNode): DetailItem[] {
  const subscriptionTopics = queuesForListener(snapshot, listener.id).flatMap(({ topics }) => topics);
  const emitters = snapshot.nodes.filter((node) => node.type === "Application" && ["emitter", "both"].includes(String(node.metadata?.role ?? "")));
  const items = emitters.flatMap((emitter) => {
    const sourceTopics = publishedTopics(snapshot, emitter.id).filter((publishTopic) => subscriptionTopics.some((topic) => topicPatternsOverlap(publishTopic, topic)));
    return sourceTopics.map((topic) => ({
      title: emitter.label,
      detail: `${topic} via ${brokerDetailItems(snapshot, emitter).map((broker) => broker.title).join(", ")}`
    }));
  });
  return items.slice(0, 12);
}

function downstreamListenersForEmitter(snapshot: TopologySnapshot, emitter: TopologyNode, publishTopics: string[]): DetailItem[] {
  const listeners = snapshot.nodes.filter((node) => node.type === "Application" && ["listener", "both"].includes(String(node.metadata?.role ?? "")));
  return listeners
    .flatMap((listener) =>
      queuesForListener(snapshot, listener.id).flatMap(({ queue, topics }) =>
        topics
          .filter((topic) => publishTopics.some((publishTopic) => topicPatternsOverlap(publishTopic, topic)))
          .map((topic) => ({
            title: listener.label,
            detail: `${queue.label} via ${brokerDetailItems(snapshot, listener).map((broker) => broker.title).join(", ")} / ${topic}`
          }))
      )
    )
    .slice(0, 12);
}

export function selectionDetailSections(snapshot: TopologySnapshot, selected: TopologyNode): DetailSection[] {
  const role = String(selected.metadata?.role ?? "");

  if (selected.type === "Broker") {
    const brokerId = String(selected.metadata?.brokerId ?? selected.id.replace(/^broker:/, ""));
    const listeners = snapshot.nodes.filter((node) => node.type === "Application" && ["listener", "both"].includes(String(node.metadata?.role ?? "")) && brokerIds(node).includes(brokerId));
    return [
      {
        title: "Physical Location",
        items: [
          { title: "Location", detail: String(selected.metadata?.physicalLocation ?? selected.metadata?.site ?? "Unknown") },
          { title: "Region", detail: String(selected.metadata?.region ?? "Unknown") },
          { title: "Environment", detail: String(selected.metadata?.environment ?? "Unknown") }
        ]
      },
      {
        title: "Managed Subscriptions",
        items: listeners.flatMap((listener) =>
          queuesForListener(snapshot, listener.id).flatMap(({ queue, topics }) =>
            topics.map((topic) => ({
              title: listener.label,
              detail: `${queue.label} subscribes to ${topic}`
            }))
          )
        )
      }
    ];
  }

  if (selected.type === "Application" && role === "emitter") {
    const publishTopics = publishedTopics(snapshot, selected.id);
    return [
      {
        title: "Connected Brokers",
        items: brokerDetailItems(snapshot, selected)
      },
      {
        title: "Published Topics",
        items: publishTopics.map((topic) => ({ title: topic, detail: "Declared publisher topic pattern" }))
      },
      {
        title: "Downstream Listeners",
        items: downstreamListenersForEmitter(snapshot, selected, publishTopics)
      }
    ];
  }

  if (selected.type === "Application" && role === "listener") {
    const subscriptions = queuesForListener(snapshot, selected.id).flatMap(({ queue, topics }) =>
      topics.map((topic) => ({
        title: queue.label,
        detail: `Subscribes to ${topic}`
      }))
    );
    return [
      {
        title: "Connected Brokers",
        items: brokerDetailItems(snapshot, selected)
      },
      {
        title: "Subscriptions",
        items: subscriptions
      },
      {
        title: "Source Emitters",
        items: sourceEmittersForListener(snapshot, selected)
      }
    ];
  }

  return [];
}
