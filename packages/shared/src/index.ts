export type NodeType =
  | "Broker"
  | "MessageVpn"
  | "Application"
  | "TopicPattern"
  | "Queue"
  | "Subscription"
  | "Owner"
  | "CostCenter";

export type EdgeType =
  | "CONNECTED_TO"
  | "PUBLISHES_TO"
  | "SUBSCRIBES_TO"
  | "CONSUMES_FROM"
  | "LINKED_TO"
  | "OWNED_BY"
  | "CHARGED_TO";

export type ApplicationRole = "emitter" | "listener" | "both";
export type Confidence = "declared" | "observed" | "declared+observed";
export type TopologyMode = "live" | "sample" | "mixed";
export type BrokerAuthMode = "basic" | "bearer";

export interface BrokerConfig {
  id: string;
  displayName: string;
  managementUrl: string;
  messageVpns: string[];
  region: string;
  site: string;
  physicalLocation?: string;
  environment: string;
  authMode?: BrokerAuthMode;
  usernameEnv?: string;
  passwordEnv?: string;
  username?: string;
  password?: string;
  sempApiKeyEnv?: string;
  sempApiKey?: string;
  tlsRejectUnauthorized: boolean;
  tags: string[];
}

export interface BrokerLinkConfig {
  from: string;
  to: string;
  kind: string;
}

export interface BrokersFile {
  brokers: BrokerConfig[];
  links: BrokerLinkConfig[];
}

export interface OwnerCatalogEntry {
  id: string;
  displayName: string;
}

export interface CostCenterCatalogEntry {
  id: string;
  displayName: string;
}

export interface ApplicationCatalogEntry {
  id: string;
  displayName: string;
  role: ApplicationRole;
  provenance: string;
  owner: string;
  costCenter: string;
  brokerIds: string[];
  clientMatchers?: string[];
  usernameMatchers?: string[];
  queueMatchers?: string[];
  publishTopicPrefixes?: string[];
  listen?: {
    queues?: string[];
    topicPrefixes?: string[];
  };
}

export interface CatalogFile {
  display: {
    title: string;
    subtitle: string;
  };
  owners: OwnerCatalogEntry[];
  costCenters: CostCenterCatalogEntry[];
  applications: ApplicationCatalogEntry[];
}

export interface TopologyScenario extends BrokersFile, CatalogFile {
  id: string;
  name: string;
}

export interface TopologyConfigFile {
  defaultScenario: string;
  scenarios: TopologyScenario[];
}

export interface ScenarioSummary {
  id: string;
  name: string;
  title: string;
  subtitle: string;
}

export interface MetricBag {
  msgRate?: number;
  byteRate?: number;
  ingressMsgRate?: number;
  egressMsgRate?: number;
  ingressByteRate?: number;
  egressByteRate?: number;
  connectedClients?: number;
  queuedMessages?: number;
  bindCount?: number;
  healthScore?: number;
}

export interface TopologyNode {
  id: string;
  type: NodeType;
  label: string;
  status?: "up" | "down" | "warning" | "unknown";
  metrics?: MetricBag;
  metadata?: Record<string, string | number | boolean | string[] | undefined>;
}

export interface TopologyEdge {
  id: string;
  type: EdgeType;
  source: string;
  target: string;
  label?: string;
  confidence?: Confidence;
  metrics?: MetricBag;
  metadata?: Record<string, string | number | boolean | string[] | undefined>;
}

export interface BrokerStatus {
  brokerId: string;
  displayName: string;
  status: "connected" | "degraded" | "unreachable" | "sample";
  mode: TopologyMode;
  lastPollAt?: string;
  latencyMs?: number;
  error?: string;
}

export interface MetricsGroup {
  id: string;
  label: string;
  msgRate: number;
  byteRate: number;
  applicationCount: number;
}

export interface MetricsSummary {
  totalMsgRate: number;
  totalByteRate: number;
  brokerCount: number;
  emittingApplicationCount: number;
  listeningApplicationCount: number;
  byBroker: MetricsGroup[];
  byProvenance: MetricsGroup[];
  byOwner: MetricsGroup[];
  byCostCenter: MetricsGroup[];
}

export interface TopologySnapshot {
  generatedAt: string;
  mode: TopologyMode;
  scenarioId: string;
  scenarioName: string;
  title: string;
  subtitle: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  brokerStatuses: BrokerStatus[];
  summary: MetricsSummary;
}

export interface LiveTopologyEvent {
  type: "snapshot";
  snapshot: TopologySnapshot;
}

export function wildcardToRegExp(pattern: string): RegExp {
  const expression = [...pattern]
    .map((char) => {
      if (char === "*" || char === ">") {
        return ".*";
      }
      if (char === "+") {
        return "[^/]+";
      }
      return char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${expression}$`, "i");
}

export function matchesAnyPattern(value: string | undefined, patterns: string[] | undefined): boolean {
  if (!value || !patterns?.length) {
    return false;
  }
  return patterns.some((pattern) => wildcardToRegExp(pattern).test(value));
}

export function formatRate(value: number | undefined, unit = "msg/s"): string {
  const safeValue = value ?? 0;
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(1)}M ${unit}`;
  }
  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(1)}k ${unit}`;
  }
  return `${safeValue.toFixed(safeValue < 10 ? 1 : 0)} ${unit}`;
}
