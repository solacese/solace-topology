import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";
import type { CatalogFile, MappingSuggestionsResponse, ScenarioSummary, TopologyConfigFile, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";
import {
  apiBaseUrl,
  fetchCatalog,
  fetchMappingSuggestions,
  fetchScenarioConfig,
  fetchScenarios,
  fetchScenarioYaml,
  fetchTopology,
  saveScenarioConfig,
  saveScenarioYaml,
  selectScenario
} from "../lib/api.js";
import { buildStaticSnapshot, scenarioSummaries } from "../lib/staticDemo.js";

const staticMode = import.meta.env.VITE_STATIC_DEMO === "true";
const demoUpdateIntervalMs = 3_000;

export function useTopology() {
  const [staticConfig, setStaticConfig] = useState<TopologyConfigFile>();
  const [snapshot, setSnapshot] = useState<TopologySnapshot>();
  const [catalog, setCatalog] = useState<CatalogFile>();
  const [scenarioConfig, setScenarioConfig] = useState<TopologyScenario>();
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState("");
  const [error, setError] = useState<string>();
  const [paused, setPaused] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const eventSourceRef = useRef<EventSource | undefined>(undefined);

  const refreshScenarioConfig = useCallback(async () => {
    if (staticMode) {
      return;
    }
    const [scenarioList, nextCatalog, nextConfig] = await Promise.all([fetchScenarios(), fetchCatalog(), fetchScenarioConfig()]);
    setScenarios(scenarioList.scenarios);
    setActiveScenarioId(scenarioList.activeScenarioId);
    setCatalog(nextCatalog);
    setScenarioConfig(nextConfig);
  }, []);

  const changeScenario = useCallback(
    async (scenarioId: string) => {
      if (staticMode) {
        const scenario = staticConfig?.scenarios.find((item) => item.id === scenarioId);
        if (!scenario) {
          return;
        }
        setActiveScenarioId(scenario.id);
        setCatalog(scenario);
        setScenarioConfig(scenario);
        setSnapshot(buildStaticSnapshot(scenario));
        setError(undefined);
        return;
      }
      if (scenarioId === activeScenarioId) {
        return;
      }
      setIsConnecting(true);
      try {
        const nextSnapshot = await selectScenario(scenarioId);
        setSnapshot(nextSnapshot);
        await refreshScenarioConfig();
        setError(undefined);
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setIsConnecting(false);
      }
    },
    [activeScenarioId, refreshScenarioConfig, staticConfig]
  );

  const updateScenarioConfig = useCallback(
    async (scenario: TopologyScenario) => {
      if (staticMode) {
        setStaticConfig((current) => {
          if (!current) {
            return current;
          }
          const scenarios = current.scenarios.map((item) => (item.id === scenario.id ? scenario : item));
          return { ...current, scenarios };
        });
        setCatalog(scenario);
        setScenarioConfig(scenario);
        setSnapshot(buildStaticSnapshot(scenario));
        return;
      }
      setIsConnecting(true);
      try {
        const nextSnapshot = await saveScenarioConfig(scenario);
        setSnapshot(nextSnapshot);
        await refreshScenarioConfig();
        setError(undefined);
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setIsConnecting(false);
      }
    },
    [refreshScenarioConfig]
  );

  const loadScenarioYaml = useCallback(async () => {
    if (staticMode) {
      return scenarioConfig ? YAML.stringify(scenarioConfig, { lineWidth: 140 }) : "";
    }
    return (await fetchScenarioYaml()).yaml;
  }, [scenarioConfig]);

  const updateScenarioYaml = useCallback(
    async (yaml: string) => {
      if (staticMode) {
        const parsed = YAML.parse(yaml) as TopologyScenario;
        await updateScenarioConfig(parsed);
        return;
      }
      setIsConnecting(true);
      try {
        const nextSnapshot = await saveScenarioYaml(yaml);
        setSnapshot(nextSnapshot);
        await refreshScenarioConfig();
        setError(undefined);
      } catch (reason) {
        setError((reason as Error).message);
        throw reason;
      } finally {
        setIsConnecting(false);
      }
    },
    [refreshScenarioConfig, updateScenarioConfig]
  );

  const suggestMappings = useCallback(async (): Promise<MappingSuggestionsResponse> => {
    if (staticMode) {
      throw new Error("The AI helper requires an API deployment with a LiteLLM proxy.");
    }
    return fetchMappingSuggestions();
  }, []);

  useEffect(() => {
    if (!staticMode) {
      return;
    }
    let cancelled = false;
    setIsConnecting(true);
    fetch(`${import.meta.env.BASE_URL}demo-config.json`)
      .then((response) => response.json() as Promise<TopologyConfigFile>)
      .then((config) => {
        if (cancelled) {
          return;
        }
        const summaries = scenarioSummaries(config);
        const scenario = config.scenarios.find((item) => item.id === config.defaultScenario) ?? config.scenarios[0]!;
        setStaticConfig(config);
        setScenarios(summaries.scenarios);
        setActiveScenarioId(scenario.id);
        setCatalog(scenario);
        setScenarioConfig(scenario);
        setSnapshot(buildStaticSnapshot(scenario));
        setError(undefined);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setIsConnecting(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (staticMode) {
      return;
    }
    let cancelled = false;
    setIsConnecting(true);
    Promise.all([fetchTopology(), refreshScenarioConfig()])
      .then(([topology]) => {
        if (cancelled) {
          return;
        }
        setSnapshot(topology);
        setError(undefined);
      })
      .catch((reason: Error) => {
        if (cancelled) {
          return;
        }
        setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) {
          setIsConnecting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshScenarioConfig]);

  useEffect(() => {
    if (!staticMode || !scenarioConfig) {
      return;
    }
    const timer = window.setInterval(() => {
      setSnapshot(buildStaticSnapshot(scenarioConfig));
    }, demoUpdateIntervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [scenarioConfig]);

  useEffect(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = undefined;
    if (staticMode || paused) {
      return;
    }

    const events = new EventSource(`${apiBaseUrl}/api/live`);
    eventSourceRef.current = events;
    events.addEventListener("snapshot", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as { snapshot: TopologySnapshot };
      setSnapshot(parsed.snapshot);
      setError(undefined);
    });
    events.onerror = () => {
      setError("Live stream disconnected. The app will retry automatically.");
    };

    return () => {
      events.close();
    };
  }, [paused]);

  return useMemo(
    () => ({
      snapshot,
      catalog,
      scenarioConfig,
      scenarios,
      activeScenarioId,
      error,
      paused,
      isConnecting,
      isStaticMode: staticMode,
      setPaused,
      changeScenario,
      updateScenarioConfig,
      loadScenarioYaml,
      updateScenarioYaml,
      suggestMappings
    }),
    [
      activeScenarioId,
      catalog,
      changeScenario,
      error,
      isConnecting,
      loadScenarioYaml,
      paused,
      scenarioConfig,
      suggestMappings,
      scenarios,
      snapshot,
      updateScenarioConfig,
      updateScenarioYaml
    ]
  );
}
