import type { ApplicationCatalogEntry, CatalogFile, MetricsGroup, MetricsSummary, TopologyNode } from "@solace-topology/shared";

function emptyGroup(id: string, label: string): MetricsGroup {
  return {
    id,
    label,
    msgRate: 0,
    byteRate: 0,
    applicationCount: 0
  };
}

function pushMetric(groups: Map<string, MetricsGroup>, id: string, label: string, msgRate: number, byteRate: number): void {
  const group = groups.get(id) ?? emptyGroup(id, label);
  group.msgRate += msgRate;
  group.byteRate += byteRate;
  group.applicationCount += 1;
  groups.set(id, group);
}

export function buildMetricsSummary(catalog: CatalogFile, nodes: TopologyNode[]): MetricsSummary {
  const appsById = new Map(catalog.applications.map((app) => [app.id, app]));
  const ownersById = new Map(catalog.owners.map((owner) => [owner.id, owner.displayName]));
  const costCentersById = new Map(catalog.costCenters.map((costCenter) => [costCenter.id, costCenter.displayName]));
  const brokerGroups = new Map<string, MetricsGroup>();
  const provenanceGroups = new Map<string, MetricsGroup>();
  const ownerGroups = new Map<string, MetricsGroup>();
  const costCenterGroups = new Map<string, MetricsGroup>();

  let totalMsgRate = 0;
  let totalByteRate = 0;
  let emittingApplicationCount = 0;
  let listeningApplicationCount = 0;

  for (const node of nodes) {
    if (node.type !== "Application") {
      continue;
    }
    const app = appsById.get(String(node.metadata?.catalogId ?? ""));
    if (!app) {
      continue;
    }
    const msgRate = node.metrics?.msgRate ?? 0;
    const byteRate = node.metrics?.byteRate ?? 0;
    totalMsgRate += msgRate;
    totalByteRate += byteRate;
    if (app.role === "emitter" || app.role === "both") {
      emittingApplicationCount += 1;
    }
    if (app.role === "listener" || app.role === "both") {
      listeningApplicationCount += 1;
    }

    for (const brokerId of app.brokerIds) {
      pushMetric(brokerGroups, brokerId, brokerId, msgRate / Math.max(app.brokerIds.length, 1), byteRate / Math.max(app.brokerIds.length, 1));
    }
    pushMetric(provenanceGroups, app.provenance, app.provenance, msgRate, byteRate);
    pushMetric(ownerGroups, app.owner, ownersById.get(app.owner) ?? app.owner, msgRate, byteRate);
    pushMetric(costCenterGroups, app.costCenter, costCentersById.get(app.costCenter) ?? app.costCenter, msgRate, byteRate);
  }

  return {
    totalMsgRate,
    totalByteRate,
    brokerCount: new Set(nodes.filter((node) => node.type === "Broker").map((node) => node.id)).size,
    emittingApplicationCount,
    listeningApplicationCount,
    byBroker: [...brokerGroups.values()],
    byProvenance: [...provenanceGroups.values()],
    byOwner: [...ownerGroups.values()],
    byCostCenter: [...costCenterGroups.values()]
  };
}
