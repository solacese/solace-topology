import type { CatalogFile, MetricsSummary, ScenarioSummary, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function login(password: string): Promise<{ token: string; expiresAt: string }> {
  const response = await fetch(`${apiBaseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (!response.ok) {
    throw new Error("Invalid password");
  }
  return (await response.json()) as { token: string; expiresAt: string };
}

export function fetchTopology(token: string): Promise<TopologySnapshot> {
  return apiFetch<TopologySnapshot>("/api/topology", token);
}

export function fetchScenarios(token: string): Promise<{ activeScenarioId: string; scenarios: ScenarioSummary[] }> {
  return apiFetch<{ activeScenarioId: string; scenarios: ScenarioSummary[] }>("/api/scenarios", token);
}

export function selectScenario(token: string, scenarioId: string): Promise<TopologySnapshot> {
  return apiFetch<TopologySnapshot>("/api/scenarios/select", token, {
    method: "POST",
    body: JSON.stringify({ scenarioId })
  });
}

export function fetchCatalog(token: string): Promise<CatalogFile> {
  return apiFetch<CatalogFile>("/api/catalog", token);
}

export function fetchScenarioConfig(token: string): Promise<TopologyScenario> {
  return apiFetch<TopologyScenario>("/api/config/scenario", token);
}

export function saveScenarioConfig(token: string, scenario: TopologyScenario): Promise<TopologySnapshot> {
  return apiFetch<TopologySnapshot>("/api/config/scenario", token, {
    method: "PUT",
    body: JSON.stringify(scenario)
  });
}

export function fetchScenarioYaml(token: string): Promise<{ scenarioId: string; yaml: string }> {
  return apiFetch<{ scenarioId: string; yaml: string }>("/api/config/yaml", token);
}

export function saveScenarioYaml(token: string, yaml: string): Promise<TopologySnapshot> {
  return apiFetch<TopologySnapshot>("/api/config/yaml", token, {
    method: "PUT",
    body: JSON.stringify({ yaml })
  });
}

export function fetchSummary(token: string): Promise<MetricsSummary> {
  return apiFetch<MetricsSummary>("/api/metrics/summary", token);
}
