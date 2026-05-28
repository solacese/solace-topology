import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config();

export interface RuntimeConfig {
  port: number;
  pollIntervalMs: number;
  topologyConfigPath: string;
  defaultScenarioId?: string;
  adminPassword: string;
  sessionSecret: string;
  sampleFallbackEnabled: boolean;
  neo4j: {
    uri: string;
    user: string;
    password: string;
    enabled: boolean;
  };
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function defaultRepoFile(pathFromRoot: string): string {
  return fileURLToPath(new URL(`../../../../${pathFromRoot}`, import.meta.url));
}

export function loadRuntimeConfig(): RuntimeConfig {
  return {
    port: intFromEnv("PORT", 8080),
    pollIntervalMs: intFromEnv("POLL_INTERVAL_MS", 5000),
    topologyConfigPath: process.env.TOPOLOGY_CONFIG_PATH ?? defaultRepoFile("config/topology.yaml"),
    defaultScenarioId: process.env.DEFAULT_SCENARIO_ID,
    adminPassword: process.env.APP_ADMIN_PASSWORD ?? "admin",
    sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret",
    sampleFallbackEnabled: boolFromEnv("SAMPLE_FALLBACK_ENABLED", true),
    neo4j: {
      uri: process.env.NEO4J_URI ?? "bolt://localhost:7687",
      user: process.env.NEO4J_USER ?? "neo4j",
      password: process.env.NEO4J_PASSWORD ?? "solace-topology",
      enabled: boolFromEnv("NEO4J_ENABLED", true)
    }
  };
}
