import fs from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";
import type { BrokersFile, CatalogFile, TopologyConfigFile, TopologyScenario } from "@solace-topology/shared";

const brokerSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  managementUrl: z.string().min(1),
  messageVpns: z.array(z.string().min(1)).min(1),
  region: z.string().min(1),
  site: z.string().min(1),
  physicalLocation: z.string().optional(),
  environment: z.string().min(1),
  authMode: z.enum(["basic", "bearer"]).default("basic"),
  usernameEnv: z.string().optional(),
  passwordEnv: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  sempApiKeyEnv: z.string().optional(),
  sempApiKey: z.string().optional(),
  tlsRejectUnauthorized: z.boolean().default(true),
  tags: z.array(z.string()).default([])
});

const linkSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().min(1)
});

const appSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  role: z.enum(["emitter", "listener", "both"]),
  provenance: z.string().min(1),
  owner: z.string().min(1),
  costCenter: z.string().min(1),
  brokerIds: z.array(z.string().min(1)).default([]),
  clientMatchers: z.array(z.string()).optional(),
  usernameMatchers: z.array(z.string()).optional(),
  queueMatchers: z.array(z.string()).optional(),
  publishTopicPrefixes: z.array(z.string()).optional(),
  listen: z
    .object({
      queues: z.array(z.string()).optional(),
      topicPrefixes: z.array(z.string()).optional()
    })
    .optional()
});

const scenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  display: z.object({
    title: z.string().min(1),
    subtitle: z.string().min(1)
  }),
  brokers: z.array(brokerSchema).min(1),
  links: z.array(linkSchema).default([]),
  owners: z.array(z.object({ id: z.string().min(1), displayName: z.string().min(1) })),
  costCenters: z.array(z.object({ id: z.string().min(1), displayName: z.string().min(1) })),
  applications: z.array(appSchema).min(1)
});

const topologyConfigSchema = z.object({
  defaultScenario: z.string().min(1),
  scenarios: z.array(scenarioSchema).min(1)
});

function interpolateEnv(source: string): string {
  return source.replace(/\$\{([A-Z0-9_]+)(:-([^}]*))?\}/g, (_match, name: string, _defaultPart, fallback: string) => {
    return process.env[name] || fallback || "";
  });
}

function normalizeScenario(parsed: z.infer<typeof scenarioSchema>): TopologyScenario {
  return {
    ...parsed,
    brokers: parsed.brokers.map((broker) => ({
      ...broker,
      authMode: broker.authMode ?? "basic",
      tlsRejectUnauthorized: broker.tlsRejectUnauthorized ?? true,
      tags: broker.tags ?? []
    })),
    links: parsed.links ?? [],
    applications: parsed.applications.map((app) => ({
      ...app,
      brokerIds: app.brokerIds ?? []
    }))
  };
}

function validateScenario(scenario: TopologyScenario): TopologyScenario {
  const brokerIds = new Set(scenario.brokers.map((broker) => broker.id));
  const invalidLink = scenario.links.find((link) => !brokerIds.has(link.from) || !brokerIds.has(link.to));
  if (invalidLink) {
    throw new Error(`Scenario ${scenario.id} has broker link referencing unknown broker: ${invalidLink.from} -> ${invalidLink.to}`);
  }

  const ownerIds = new Set(scenario.owners.map((owner) => owner.id));
  const costCenterIds = new Set(scenario.costCenters.map((costCenter) => costCenter.id));
  const invalidOwner = scenario.applications.find((app) => !ownerIds.has(app.owner));
  const invalidCostCenter = scenario.applications.find((app) => !costCenterIds.has(app.costCenter));
  if (invalidOwner) {
    throw new Error(`Scenario ${scenario.id} application ${invalidOwner.id} references unknown owner ${invalidOwner.owner}`);
  }
  if (invalidCostCenter) {
    throw new Error(`Scenario ${scenario.id} application ${invalidCostCenter.id} references unknown cost center ${invalidCostCenter.costCenter}`);
  }
  return scenario;
}

export async function loadTopologyConfig(filePath: string): Promise<TopologyConfigFile> {
  const content = await fs.readFile(filePath, "utf8");
  const parsed = topologyConfigSchema.parse(YAML.parse(interpolateEnv(content)));
  const scenarios = parsed.scenarios.map((scenario) => validateScenario(normalizeScenario(scenario)));
  const defaultScenario = scenarios.some((scenario) => scenario.id === parsed.defaultScenario) ? parsed.defaultScenario : scenarios[0]!.id;
  return { defaultScenario, scenarios };
}

export function scenarioToFiles(scenario: TopologyScenario): { brokersFile: BrokersFile; catalog: CatalogFile } {
  return {
    brokersFile: {
      brokers: scenario.brokers,
      links: scenario.links
    },
    catalog: {
      display: scenario.display,
      owners: scenario.owners,
      costCenters: scenario.costCenters,
      applications: scenario.applications
    }
  };
}

export function parseScenarioYaml(source: string, fallbackId = "custom"): TopologyScenario {
  const parsed = YAML.parse(interpolateEnv(source));
  if (parsed?.scenarios) {
    const config = topologyConfigSchema.parse(parsed);
    const scenario = config.scenarios.find((item) => item.id === config.defaultScenario) ?? config.scenarios[0];
    if (!scenario) {
      throw new Error("No scenario found in YAML");
    }
    return validateScenario(normalizeScenario(scenario));
  }

  const scenario = scenarioSchema.parse({
    id: fallbackId,
    name: fallbackId,
    ...parsed
  });
  return validateScenario(normalizeScenario(scenario));
}

export function stringifyScenarioYaml(scenario: TopologyScenario): string {
  return YAML.stringify(scenario, {
    lineWidth: 140
  });
}
