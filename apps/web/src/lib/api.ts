import type { CatalogFile, MappingSuggestionsResponse, MetricsSummary, ScenarioSummary, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function fetchTopology(): Promise<TopologySnapshot> {
  return apiFetch<TopologySnapshot>("/api/topology");
}

export function fetchScenarios(): Promise<{ activeScenarioId: string; scenarios: ScenarioSummary[] }> {
  return apiFetch<{ activeScenarioId: string; scenarios: ScenarioSummary[] }>("/api/scenarios");
}

export function selectScenario(scenarioId: string): Promise<TopologySnapshot> {
  return apiFetch<TopologySnapshot>("/api/scenarios/select", {
    method: "POST",
    body: JSON.stringify({ scenarioId })
  });
}

export function fetchCatalog(): Promise<CatalogFile> {
  return apiFetch<CatalogFile>("/api/catalog");
}

export function fetchScenarioConfig(): Promise<TopologyScenario> {
  return apiFetch<TopologyScenario>("/api/config/scenario");
}

export function saveScenarioConfig(scenario: TopologyScenario): Promise<TopologySnapshot> {
  return apiFetch<TopologySnapshot>("/api/config/scenario", {
    method: "PUT",
    body: JSON.stringify(scenario)
  });
}

export function fetchScenarioYaml(): Promise<{ scenarioId: string; yaml: string }> {
  return apiFetch<{ scenarioId: string; yaml: string }>("/api/config/yaml");
}

export function saveScenarioYaml(yaml: string): Promise<TopologySnapshot> {
  return apiFetch<TopologySnapshot>("/api/config/yaml", {
    method: "PUT",
    body: JSON.stringify({ yaml })
  });
}

export function fetchSummary(): Promise<MetricsSummary> {
  return apiFetch<MetricsSummary>("/api/metrics/summary");
}

export function fetchMappingSuggestions(): Promise<MappingSuggestionsResponse> {
  return apiFetch<MappingSuggestionsResponse>("/api/ai/mapping-suggestions", {
    method: "POST",
    body: "{}"
  });
}

export interface TimeSeriesPoint {
  timestamp: string;
  totalMsgRate: number;
  totalByteRate: number;
  brokerCount: number;
  emitterCount: number;
  listenerCount: number;
}

export interface HistoryResponse {
  points: TimeSeriesPoint[];
  size: number;
  oldest?: string;
  newest?: string;
}

export function fetchHistory(params?: {
  since?: string;
  until?: string;
  limit?: number;
  resolution?: "raw" | "1m" | "5m" | "1h";
}): Promise<HistoryResponse> {
  const searchParams = new URLSearchParams();
  if (params?.since) searchParams.set("since", params.since);
  if (params?.until) searchParams.set("until", params.until);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.resolution) searchParams.set("resolution", params.resolution);
  const qs = searchParams.toString();
  return apiFetch<HistoryResponse>(`/api/history${qs ? `?${qs}` : ""}`);
}
