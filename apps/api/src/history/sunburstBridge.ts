/**
 * Sunburst Bridge
 *
 * Transforms topology snapshot data into the hierarchical topic-tree format
 * compatible with the Solace Sunburst Topic Explorer's data model.
 *
 * The Sunburst Explorer uses a tree where:
 *  - Each node = a topic level (split by '/')
 *  - Metrics = message count, byte count, unique topics, msg rate
 *
 * This bridge generates a STATIC topic tree from the catalog's declared
 * publish/subscribe topics — enriched with live msg rates from SEMP.
 * The Explorer then consumes this as an initial "scan" that it can
 * augment with real-time traffic.
 *
 * Integration approach:
 *  1. Topology API exposes /api/sunburst/scan → pre-built topic tree JSON
 *  2. Explorer loads scan via its "import" feature or via postMessage()
 *  3. Explorer continues subscribing to live traffic on top of the base
 *
 * The bridge also generates a security-annotated tree for the combined view:
 *  - Nodes colored by ACL coverage (from SEMP config data)
 *  - Topic levels flagged as sensitive (passwords, tokens, admin, $SYS)
 *  - Per-topic publisher/subscriber counts for density analysis
 */

import type { TopologyEdge, TopologyNode, TopologySnapshot } from "@solace-topology/shared";

export interface SunburstNode {
  name: string;
  path: string;
  msgs: number;
  bytes: number;
  topics: number;
  rate: number;
  publishers: string[];
  subscribers: string[];
  children: SunburstNode[];
  /** Security annotations (optional) */
  security?: {
    sensitive: boolean;
    aclProtected: boolean;
    anonymousAccess: boolean;
    publisherCount: number;
    subscriberCount: number;
  };
}

const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /credential/i,
  /\$sys/i,
  /admin/i,
  /auth/i,
  /key/i,
  /cert/i,
  /private/i,
];

function isSensitiveTopic(level: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(level));
}

function getOrCreateChild(parent: SunburstNode, level: string, pathPrefix: string): SunburstNode {
  const path = pathPrefix ? `${pathPrefix}/${level}` : level;
  let child = parent.children.find((c) => c.name === level);
  if (!child) {
    child = {
      name: level,
      path,
      msgs: 0,
      bytes: 0,
      topics: 0,
      rate: 0,
      publishers: [],
      subscribers: [],
      children: [],
    };
    parent.children.push(child);
  }
  return child;
}

function insertTopic(
  root: SunburstNode,
  topicPattern: string,
  role: "publisher" | "subscriber",
  appLabel: string,
  msgRate: number,
): void {
  // Expand wildcards to a marker level
  const levels = topicPattern.split("/").map((l) => (l === ">" || l === "*" || l === "+" ? "*" : l));
  let current = root;
  let pathSoFar = "";

  for (const level of levels) {
    current = getOrCreateChild(current, level, pathSoFar);
    pathSoFar = current.path;
  }

  current.topics += 1;
  current.rate += msgRate;
  if (role === "publisher") {
    if (!current.publishers.includes(appLabel)) {
      current.publishers.push(appLabel);
    }
  } else {
    if (!current.subscribers.includes(appLabel)) {
      current.subscribers.push(appLabel);
    }
  }
}

function annotateSecurityRecursive(node: SunburstNode): void {
  node.security = {
    sensitive: isSensitiveTopic(node.name),
    aclProtected: false, // Would need SEMP ACL data to populate
    anonymousAccess: false, // Would need auth config data
    publisherCount: node.publishers.length,
    subscriberCount: node.subscribers.length,
  };
  for (const child of node.children) {
    annotateSecurityRecursive(child);
  }
}

export function buildSunburstTree(snapshot: TopologySnapshot): SunburstNode {
  const root: SunburstNode = {
    name: "/",
    path: "",
    msgs: 0,
    bytes: 0,
    topics: 0,
    rate: 0,
    publishers: [],
    subscribers: [],
    children: [],
  };

  // Build index of topic pattern labels
  const topicNodes = new Map<string, string>();
  for (const node of snapshot.nodes) {
    if (node.type === "TopicPattern" || node.type === "Subscription") {
      topicNodes.set(node.id, node.label);
    }
  }

  // Find publisher → topic edges
  for (const edge of snapshot.edges) {
    if (edge.type === "PUBLISHES_TO") {
      const app = snapshot.nodes.find((n) => n.id === edge.source);
      const topicLabel = topicNodes.get(edge.target);
      if (app && topicLabel) {
        insertTopic(root, topicLabel, "publisher", app.label, app.metrics?.msgRate ?? 0);
      }
    }
    if (edge.type === "SUBSCRIBES_TO") {
      // queue → topic subscription
      const queueId = edge.source;
      const topicLabel = topicNodes.get(edge.target);
      // Find the app that consumes from this queue
      const consumerEdge = snapshot.edges.find((e) => e.type === "CONSUMES_FROM" && e.target === queueId);
      const app = consumerEdge ? snapshot.nodes.find((n) => n.id === consumerEdge.source) : undefined;
      if (app && topicLabel) {
        insertTopic(root, topicLabel, "subscriber", app.label, app.metrics?.msgRate ?? 0);
      }
    }
  }

  annotateSecurityRecursive(root);
  return root;
}

/**
 * Flatten the tree to a format suitable for D3 sunburst/icicle.
 * Each node gets a `value` prop = sum of its rate or topic count.
 */
export interface FlatSunburstNode {
  name: string;
  path: string;
  value: number;
  publishers: number;
  subscribers: number;
  sensitive: boolean;
  children?: FlatSunburstNode[];
}

export function flattenForD3(node: SunburstNode, metric: "rate" | "topics" = "rate"): FlatSunburstNode {
  const children = node.children.map((child) => flattenForD3(child, metric));
  const value = metric === "rate" ? node.rate : node.topics;
  return {
    name: node.name,
    path: node.path,
    value: children.length > 0 ? 0 : Math.max(value, 1),
    publishers: node.publishers.length,
    subscribers: node.subscribers.length,
    sensitive: node.security?.sensitive ?? false,
    ...(children.length > 0 ? { children } : {}),
  };
}
