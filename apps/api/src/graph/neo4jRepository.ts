import neo4j, { type Driver } from "neo4j-driver";
import type { EdgeType, NodeType, TopologyEdge, TopologyNode, TopologySnapshot } from "@solace-topology/shared";

const nodeTypes: NodeType[] = ["Broker", "MessageVpn", "Application", "TopicPattern", "Queue", "Subscription", "Owner", "CostCenter"];
const edgeTypes: EdgeType[] = ["CONNECTED_TO", "PUBLISHES_TO", "SUBSCRIBES_TO", "CONSUMES_FROM", "LINKED_TO", "OWNED_BY", "CHARGED_TO"];

function isNodeType(type: string): type is NodeType {
  return nodeTypes.includes(type as NodeType);
}

function isEdgeType(type: string): type is EdgeType {
  return edgeTypes.includes(type as EdgeType);
}

function flatten(prefix: string, value: Record<string, unknown> | undefined): Record<string, string | number | boolean | string[]> {
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (item === undefined) {
      continue;
    }
    const propKey = `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (Array.isArray(item)) {
      result[propKey] = item.map(String);
    } else if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      result[propKey] = item;
    } else {
      result[propKey] = JSON.stringify(item);
    }
  }
  return result;
}

function nodeProps(node: TopologyNode, snapshot: TopologySnapshot): Record<string, unknown> {
  return {
    id: node.id,
    label: node.label,
    type: node.type,
    status: node.status ?? "unknown",
    snapshotGeneratedAt: snapshot.generatedAt,
    mode: snapshot.mode,
    ...flatten("metric", node.metrics as Record<string, unknown> | undefined),
    ...flatten("meta", node.metadata as Record<string, unknown> | undefined)
  };
}

function edgeProps(edge: TopologyEdge, snapshot: TopologySnapshot): Record<string, unknown> {
  return {
    id: edge.id,
    label: edge.label ?? edge.type,
    type: edge.type,
    confidence: edge.confidence ?? "observed",
    snapshotGeneratedAt: snapshot.generatedAt,
    mode: snapshot.mode,
    ...flatten("metric", edge.metrics as Record<string, unknown> | undefined),
    ...flatten("meta", edge.metadata as Record<string, unknown> | undefined)
  };
}

export class Neo4jRepository {
  private driver: Driver | undefined;
  private ready = false;

  constructor(
    private readonly uri: string,
    private readonly user: string,
    private readonly password: string,
    private readonly enabled: boolean
  ) {}

  async connect(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      this.driver = neo4j.driver(this.uri, neo4j.auth.basic(this.user, this.password));
      await this.driver.verifyConnectivity();
      await this.ensureConstraints();
      this.ready = true;
      console.info(`Connected to Neo4j at ${this.uri}`);
    } catch (error) {
      this.ready = false;
      console.warn(`Neo4j unavailable; API will continue without graph persistence: ${(error as Error).message}`);
      await this.close();
    }
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = undefined;
    this.ready = false;
  }

  async writeSnapshot(snapshot: TopologySnapshot): Promise<void> {
    if (!this.driver || !this.ready) {
      return;
    }
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        for (const type of nodeTypes) {
          const nodes = snapshot.nodes.filter((node) => node.type === type).map((node) => nodeProps(node, snapshot));
          if (nodes.length === 0) {
            continue;
          }
          await tx.run(`UNWIND $nodes AS props MERGE (n:TopologyEntity:${type} {id: props.id}) SET n += props`, { nodes });
        }

        for (const type of edgeTypes) {
          const edges = snapshot.edges.filter((edge) => edge.type === type).map((edge) => ({
            source: edge.source,
            target: edge.target,
            props: edgeProps(edge, snapshot)
          }));
          if (edges.length === 0) {
            continue;
          }
          await tx.run(
            `UNWIND $edges AS edge
             MATCH (source:TopologyEntity {id: edge.source})
             MATCH (target:TopologyEntity {id: edge.target})
             MERGE (source)-[rel:${type} {id: edge.props.id}]->(target)
             SET rel += edge.props`,
            { edges }
          );
        }
      });
    } catch (error) {
      console.warn(`Failed to write topology snapshot to Neo4j: ${(error as Error).message}`);
    } finally {
      await session.close();
    }
  }

  private async ensureConstraints(): Promise<void> {
    if (!this.driver) {
      return;
    }
    const session = this.driver.session();
    try {
      await session.run("CREATE CONSTRAINT topology_entity_id IF NOT EXISTS FOR (n:TopologyEntity) REQUIRE n.id IS UNIQUE");
      for (const type of nodeTypes) {
        if (!isNodeType(type)) {
          continue;
        }
        await session.run(`CREATE INDEX topology_${type.toLowerCase()}_label IF NOT EXISTS FOR (n:${type}) ON (n.label)`);
      }
      for (const type of edgeTypes) {
        if (!isEdgeType(type)) {
          continue;
        }
        await session.run(`CREATE INDEX topology_rel_${type.toLowerCase()}_id IF NOT EXISTS FOR ()-[r:${type}]-() ON (r.id)`);
      }
    } finally {
      await session.close();
    }
  }
}
