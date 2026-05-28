import {
  matchesAnyPattern,
  type ApplicationCatalogEntry,
  type BrokersFile,
  type CatalogFile,
  type Confidence,
  type TopologyEdge,
  type TopologyMode,
  type TopologyNode,
  type TopologySnapshot
} from "@solace-topology/shared";
import type { BrokerObservation, ClientObservation, QueueObservation } from "./types.js";
import { buildMetricsSummary } from "../metrics/summary.js";

interface SnapshotIdentity {
  scenarioId: string;
  scenarioName: string;
}

function addNode(nodes: Map<string, TopologyNode>, node: TopologyNode): void {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, node);
    return;
  }
  existing.metrics = {
    ...existing.metrics,
    msgRate: (existing.metrics?.msgRate ?? 0) + (node.metrics?.msgRate ?? 0),
    byteRate: (existing.metrics?.byteRate ?? 0) + (node.metrics?.byteRate ?? 0),
    connectedClients: (existing.metrics?.connectedClients ?? 0) + (node.metrics?.connectedClients ?? 0),
    queuedMessages: (existing.metrics?.queuedMessages ?? 0) + (node.metrics?.queuedMessages ?? 0),
    bindCount: (existing.metrics?.bindCount ?? 0) + (node.metrics?.bindCount ?? 0)
  };
}

function edgeId(type: string, source: string, target: string, suffix = ""): string {
  return `${type}:${source}->${target}${suffix ? `:${suffix}` : ""}`;
}

function appMatchesClient(app: ApplicationCatalogEntry, client: ClientObservation): boolean {
  return matchesAnyPattern(client.name, app.clientMatchers) || matchesAnyPattern(client.username, app.usernameMatchers);
}

function appMatchesQueue(app: ApplicationCatalogEntry, queue: QueueObservation): boolean {
  return matchesAnyPattern(queue.name, app.queueMatchers) || (app.listen?.queues ?? []).includes(queue.name);
}

function appRateFromClients(app: ApplicationCatalogEntry, clients: ClientObservation[]): { msgRate: number; byteRate: number; connectedClients: number } {
  const matched = clients.filter((client) => appMatchesClient(app, client));
  if (matched.length === 0) {
    return { msgRate: 0, byteRate: 0, connectedClients: 0 };
  }
  const usesIngress = app.role === "emitter" || app.role === "both";
  return matched.reduce(
    (acc, client) => ({
      msgRate: acc.msgRate + (usesIngress ? client.ingressMsgRate : client.egressMsgRate),
      byteRate: acc.byteRate + (usesIngress ? client.ingressByteRate : client.egressByteRate),
      connectedClients: acc.connectedClients + (client.connected ? 1 : 0)
    }),
    { msgRate: 0, byteRate: 0, connectedClients: 0 }
  );
}

function appRateFromQueues(app: ApplicationCatalogEntry, queues: QueueObservation[]): { msgRate: number; byteRate: number; bindCount: number; queuedMessages: number } {
  const matched = queues.filter((queue) => appMatchesQueue(app, queue));
  return matched.reduce(
    (acc, queue) => ({
      msgRate: acc.msgRate + queue.egressMsgRate,
      byteRate: acc.byteRate + queue.egressByteRate,
      bindCount: acc.bindCount + queue.bindCount,
      queuedMessages: acc.queuedMessages + queue.queuedMessages
    }),
    { msgRate: 0, byteRate: 0, bindCount: 0, queuedMessages: 0 }
  );
}

function confidenceFor(rate: number, declared: boolean): Confidence {
  if (declared && rate > 0) {
    return "declared+observed";
  }
  return declared ? "declared" : "observed";
}

export function buildTopologySnapshot(brokersFile: BrokersFile, catalog: CatalogFile, observations: BrokerObservation[], identity: SnapshotIdentity): TopologySnapshot {
  const nodes = new Map<string, TopologyNode>();
  const edges = new Map<string, TopologyEdge>();
  const observationsByBroker = new Map(observations.map((observation) => [observation.brokerId, observation]));
  const mode: TopologyMode = observations.every((observation) => observation.mode === "sample")
    ? "sample"
    : observations.some((observation) => observation.mode === "sample")
      ? "mixed"
      : "live";

  for (const broker of brokersFile.brokers) {
    const observation = observationsByBroker.get(broker.id);
    addNode(nodes, {
      id: `broker:${broker.id}`,
      type: "Broker",
      label: broker.displayName,
      status: observation?.status.status === "connected" || observation?.status.status === "sample" ? "up" : "down",
      metrics: {
        msgRate:
          observation?.clients.reduce((sum, client) => sum + client.ingressMsgRate + client.egressMsgRate, 0) ??
          0,
        connectedClients: observation?.clients.filter((client) => client.connected).length ?? 0,
        healthScore: observation?.status.status === "connected" || observation?.status.status === "sample" ? 100 : 0
      },
      metadata: {
        brokerId: broker.id,
        region: broker.region,
        site: broker.site,
        physicalLocation: broker.physicalLocation ?? broker.site,
        environment: broker.environment,
        tags: broker.tags,
        mode: observation?.mode ?? "live"
      }
    });

    for (const vpnName of broker.messageVpns) {
      const vpnNodeId = `vpn:${broker.id}:${vpnName}`;
      addNode(nodes, {
        id: vpnNodeId,
        type: "MessageVpn",
        label: vpnName,
        status: observation ? "up" : "unknown",
        metrics: {
          connectedClients: observation?.clients.filter((client) => client.vpnName === vpnName && client.connected).length ?? 0
        },
        metadata: {
          brokerId: broker.id,
          vpnName
        }
      });
      edges.set(edgeId("CONNECTED_TO", `broker:${broker.id}`, vpnNodeId), {
        id: edgeId("CONNECTED_TO", `broker:${broker.id}`, vpnNodeId),
        type: "CONNECTED_TO",
        source: `broker:${broker.id}`,
        target: vpnNodeId,
        label: "hosts"
      });
    }
  }

  for (const link of brokersFile.links) {
    const source = `broker:${link.from}`;
    const target = `broker:${link.to}`;
    edges.set(edgeId("LINKED_TO", source, target, link.kind), {
      id: edgeId("LINKED_TO", source, target, link.kind),
      type: "LINKED_TO",
      source,
      target,
      label: link.kind,
      confidence: "declared",
      metadata: { kind: link.kind }
    });
  }

  for (const owner of catalog.owners) {
    addNode(nodes, {
      id: `owner:${owner.id}`,
      type: "Owner",
      label: owner.displayName,
      metadata: { catalogId: owner.id }
    });
  }

  for (const costCenter of catalog.costCenters) {
    addNode(nodes, {
      id: `cost-center:${costCenter.id}`,
      type: "CostCenter",
      label: costCenter.displayName,
      metadata: { catalogId: costCenter.id }
    });
  }

  for (const app of catalog.applications) {
    const appObservations = app.brokerIds.map((brokerId) => observationsByBroker.get(brokerId)).filter((value): value is BrokerObservation => Boolean(value));
    const clientRate = appObservations.reduce(
      (acc, observation) => {
        const rate = appRateFromClients(app, observation.clients);
        return {
          msgRate: acc.msgRate + rate.msgRate,
          byteRate: acc.byteRate + rate.byteRate,
          connectedClients: acc.connectedClients + rate.connectedClients
        };
      },
      { msgRate: 0, byteRate: 0, connectedClients: 0 }
    );
    const queueRate = appObservations.reduce(
      (acc, observation) => {
        const rate = appRateFromQueues(app, observation.queues);
        return {
          msgRate: acc.msgRate + rate.msgRate,
          byteRate: acc.byteRate + rate.byteRate,
          bindCount: acc.bindCount + rate.bindCount,
          queuedMessages: acc.queuedMessages + rate.queuedMessages
        };
      },
      { msgRate: 0, byteRate: 0, bindCount: 0, queuedMessages: 0 }
    );
    const appMsgRate = clientRate.msgRate || queueRate.msgRate;
    const appByteRate = clientRate.byteRate || queueRate.byteRate;
    const appNodeId = `app:${app.id}`;

    addNode(nodes, {
      id: appNodeId,
      type: "Application",
      label: app.displayName,
      status: clientRate.connectedClients > 0 || queueRate.bindCount > 0 || mode === "sample" ? "up" : "unknown",
      metrics: {
        msgRate: appMsgRate,
        byteRate: appByteRate,
        connectedClients: clientRate.connectedClients,
        bindCount: queueRate.bindCount,
        queuedMessages: queueRate.queuedMessages
      },
      metadata: {
        catalogId: app.id,
        role: app.role,
        provenance: app.provenance,
        owner: app.owner,
        costCenter: app.costCenter,
        brokerIds: app.brokerIds
      }
    });

    edges.set(edgeId("OWNED_BY", appNodeId, `owner:${app.owner}`), {
      id: edgeId("OWNED_BY", appNodeId, `owner:${app.owner}`),
      type: "OWNED_BY",
      source: appNodeId,
      target: `owner:${app.owner}`,
      label: "owned by"
    });
    edges.set(edgeId("CHARGED_TO", appNodeId, `cost-center:${app.costCenter}`), {
      id: edgeId("CHARGED_TO", appNodeId, `cost-center:${app.costCenter}`),
      type: "CHARGED_TO",
      source: appNodeId,
      target: `cost-center:${app.costCenter}`,
      label: "charged to"
    });

    for (const brokerId of app.brokerIds) {
      const vpnName = brokersFile.brokers.find((broker) => broker.id === brokerId)?.messageVpns[0];
      if (!vpnName) {
        continue;
      }
      edges.set(edgeId("CONNECTED_TO", appNodeId, `vpn:${brokerId}:${vpnName}`), {
        id: edgeId("CONNECTED_TO", appNodeId, `vpn:${brokerId}:${vpnName}`),
        type: "CONNECTED_TO",
        source: appNodeId,
        target: `vpn:${brokerId}:${vpnName}`,
        label: "connects",
        confidence: clientRate.connectedClients > 0 ? "declared+observed" : "declared",
        metrics: { msgRate: appMsgRate, byteRate: appByteRate }
      });
    }

    for (const topic of app.publishTopicPrefixes ?? []) {
      const topicNodeId = `topic:${topic}`;
      addNode(nodes, {
        id: topicNodeId,
        type: "TopicPattern",
        label: topic,
        metrics: { msgRate: appMsgRate, byteRate: appByteRate },
        metadata: { direction: "publish" }
      });
      edges.set(edgeId("PUBLISHES_TO", appNodeId, topicNodeId), {
        id: edgeId("PUBLISHES_TO", appNodeId, topicNodeId),
        type: "PUBLISHES_TO",
        source: appNodeId,
        target: topicNodeId,
        label: "publishes",
        confidence: confidenceFor(appMsgRate, true),
        metrics: { msgRate: appMsgRate, byteRate: appByteRate }
      });
    }

    for (const queueName of app.listen?.queues ?? []) {
      const queueNodeId = `queue:${queueName}`;
      addNode(nodes, {
        id: queueNodeId,
        type: "Queue",
        label: queueName,
        metrics: {
          msgRate: queueRate.msgRate,
          byteRate: queueRate.byteRate,
          bindCount: queueRate.bindCount,
          queuedMessages: queueRate.queuedMessages
        },
        metadata: { queueName }
      });
      edges.set(edgeId("CONSUMES_FROM", appNodeId, queueNodeId), {
        id: edgeId("CONSUMES_FROM", appNodeId, queueNodeId),
        type: "CONSUMES_FROM",
        source: appNodeId,
        target: queueNodeId,
        label: "consumes",
        confidence: confidenceFor(queueRate.msgRate, true),
        metrics: { msgRate: queueRate.msgRate, byteRate: queueRate.byteRate }
      });
    }

    for (const topic of app.listen?.topicPrefixes ?? []) {
      const topicNodeId = `topic:${topic}`;
      addNode(nodes, {
        id: topicNodeId,
        type: "TopicPattern",
        label: topic,
        metrics: { msgRate: queueRate.msgRate, byteRate: queueRate.byteRate },
        metadata: { direction: "subscribe" }
      });
      for (const queueName of app.listen?.queues ?? []) {
        edges.set(edgeId("SUBSCRIBES_TO", `queue:${queueName}`, topicNodeId), {
          id: edgeId("SUBSCRIBES_TO", `queue:${queueName}`, topicNodeId),
          type: "SUBSCRIBES_TO",
          source: `queue:${queueName}`,
          target: topicNodeId,
          label: "subscribes",
          confidence: confidenceFor(queueRate.msgRate, true),
          metrics: { msgRate: queueRate.msgRate, byteRate: queueRate.byteRate }
        });
      }
    }
  }

  for (const observation of observations) {
    for (const queue of observation.queues) {
      const queueNodeId = `queue:${queue.name}`;
      addNode(nodes, {
        id: queueNodeId,
        type: "Queue",
        label: queue.name,
        metrics: {
          msgRate: queue.egressMsgRate,
          byteRate: queue.egressByteRate,
          bindCount: queue.bindCount,
          queuedMessages: queue.queuedMessages
        },
        metadata: { brokerId: queue.brokerId, vpnName: queue.vpnName, queueName: queue.name }
      });
      edges.set(edgeId("CONNECTED_TO", queueNodeId, `vpn:${queue.brokerId}:${queue.vpnName}`), {
        id: edgeId("CONNECTED_TO", queueNodeId, `vpn:${queue.brokerId}:${queue.vpnName}`),
        type: "CONNECTED_TO",
        source: queueNodeId,
        target: `vpn:${queue.brokerId}:${queue.vpnName}`,
        label: "on"
      });
    }

    for (const subscription of observation.subscriptions) {
      const topicNodeId = `topic:${subscription.topic}`;
      addNode(nodes, {
        id: topicNodeId,
        type: "TopicPattern",
        label: subscription.topic,
        metadata: { direction: "subscribe" }
      });
      edges.set(edgeId("SUBSCRIBES_TO", `queue:${subscription.queueName}`, topicNodeId), {
        id: edgeId("SUBSCRIBES_TO", `queue:${subscription.queueName}`, topicNodeId),
        type: "SUBSCRIBES_TO",
        source: `queue:${subscription.queueName}`,
        target: topicNodeId,
        label: "subscribes",
        confidence: "observed"
      });
    }
  }

  const nodeList = [...nodes.values()];
  return {
    generatedAt: new Date().toISOString(),
    mode,
    scenarioId: identity.scenarioId,
    scenarioName: identity.scenarioName,
    title: catalog.display.title,
    subtitle: catalog.display.subtitle,
    nodes: nodeList,
    edges: [...edges.values()],
    brokerStatuses: observations.map((observation) => observation.status),
    summary: buildMetricsSummary(catalog, nodeList)
  };
}
