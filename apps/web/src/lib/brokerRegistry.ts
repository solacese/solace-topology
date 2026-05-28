import type { BrokerAuthMode, BrokerConfig, BrokerStatus, TopologyNode } from "@solace-topology/shared";

export interface BrokerRecord {
  id: string;
  displayName: string;
  managementUrl: string;
  messageVpn: string;
  site: string;
  region: string;
  physicalLocation: string;
  environment: string;
  authMode: BrokerAuthMode;
  username: string;
  password: string;
  sempApiKey: string;
  status: BrokerStatus["status"];
}

export function brokerIdFromNode(node: TopologyNode): string {
  return String(node.metadata?.brokerId ?? node.id.replace(/^broker:/, ""));
}

export function statusLabel(status: BrokerStatus["status"]): string {
  if (status === "connected" || status === "sample") {
    return "Live";
  }
  if (status === "degraded") {
    return "Degraded";
  }
  return "Offline";
}

export function brokerRecordFromNode(node: TopologyNode, status?: BrokerStatus): BrokerRecord {
  return {
    id: brokerIdFromNode(node),
    displayName: node.label,
    managementUrl: "",
    messageVpn: "",
    site: String(node.metadata?.site ?? ""),
    region: String(node.metadata?.region ?? ""),
    physicalLocation: String(node.metadata?.physicalLocation ?? node.metadata?.site ?? ""),
    environment: String(node.metadata?.environment ?? ""),
    authMode: "basic",
    username: "",
    password: "",
    sempApiKey: "",
    status: status?.status ?? (node.status === "down" ? "unreachable" : "connected")
  };
}

export function brokerRecordFromConfig(broker: BrokerConfig, status?: BrokerStatus): BrokerRecord {
  return {
    id: broker.id,
    displayName: broker.displayName,
    managementUrl: broker.managementUrl,
    messageVpn: broker.messageVpns[0] ?? "",
    site: broker.site,
    region: broker.region,
    physicalLocation: broker.physicalLocation ?? broker.site,
    environment: broker.environment,
    authMode: broker.authMode ?? "basic",
    username: broker.username ?? "",
    password: broker.password ?? "",
    sempApiKey: broker.sempApiKey ?? "",
    status: status?.status ?? "connected"
  };
}

export function brokerConfigFromRecord(record: BrokerRecord, previous?: BrokerConfig): BrokerConfig {
  const id = record.id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  return {
    ...(previous ?? {}),
    id,
    displayName: record.displayName.trim(),
    managementUrl: record.managementUrl.trim(),
    messageVpns: [record.messageVpn.trim()].filter(Boolean),
    region: record.region.trim(),
    site: record.site.trim(),
    physicalLocation: record.physicalLocation.trim(),
    environment: record.environment.trim(),
    authMode: record.authMode,
    username: record.username.trim() || undefined,
    password: record.password || undefined,
    sempApiKey: record.sempApiKey || undefined,
    tlsRejectUnauthorized: previous?.tlsRejectUnauthorized ?? true,
    tags: previous?.tags ?? ["manual"]
  };
}
