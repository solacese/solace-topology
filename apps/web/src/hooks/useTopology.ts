import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";
import type { CatalogFile, ScenarioSummary, TopologyConfigFile, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";
import {
  apiBaseUrl,
  fetchCatalog,
  fetchScenarioConfig,
  fetchScenarios,
  fetchScenarioYaml,
  fetchTopology,
  login,
  saveScenarioConfig,
  saveScenarioYaml,
  selectScenario
} from "../lib/api.js";
import { buildStaticSnapshot, scenarioSummaries } from "../lib/staticDemo.js";

const tokenKey = "solace-topology-token";
const staticMode = import.meta.env.VITE_STATIC_DEMO === "true";

export function useTopology() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey) ?? "");
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

  const isAuthenticated = staticMode || Boolean(token);

  const refreshScenarioConfig = useCallback(
    async (nextToken = token) => {
      if (staticMode) {
        return;
      }
      const [scenarioList, nextCatalog, nextConfig] = await Promise.all([fetchScenarios(nextToken), fetchCatalog(nextToken), fetchScenarioConfig(nextToken)]);
      setScenarios(scenarioList.scenarios);
      setActiveScenarioId(scenarioList.activeScenarioId);
      setCatalog(nextCatalog);
      setScenarioConfig(nextConfig);
    },
    [token]
  );

  const signIn = useCallback(async (password: string) => {
    if (staticMode) {
      return;
    }
    setError(undefined);
    const session = await login(password);
    localStorage.setItem(tokenKey, session.token);
    setToken(session.token);
  }, []);

  const signOut = useCallback(() => {
    if (staticMode) {
      return;
    }
    localStorage.removeItem(tokenKey);
    setToken("");
    setSnapshot(undefined);
    setCatalog(undefined);
    setScenarioConfig(undefined);
    setScenarios([]);
    setActiveScenarioId("");
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
      if (!token || scenarioId === activeScenarioId) {
        return;
      }
      setIsConnecting(true);
      try {
        const nextSnapshot = await selectScenario(token, scenarioId);
        setSnapshot(nextSnapshot);
        await refreshScenarioConfig(token);
        setError(undefined);
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setIsConnecting(false);
      }
    },
    [activeScenarioId, refreshScenarioConfig, staticConfig, token]
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
      if (!token) {
        return;
      }
      setIsConnecting(true);
      try {
        const nextSnapshot = await saveScenarioConfig(token, scenario);
        setSnapshot(nextSnapshot);
        await refreshScenarioConfig(token);
        setError(undefined);
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setIsConnecting(false);
      }
    },
    [refreshScenarioConfig, token]
  );

  const loadScenarioYaml = useCallback(async () => {
    if (staticMode) {
      return scenarioConfig ? YAML.stringify(scenarioConfig, { lineWidth: 140 }) : "";
    }
    if (!token) {
      return "";
    }
    return (await fetchScenarioYaml(token)).yaml;
  }, [scenarioConfig, token]);

  const updateScenarioYaml = useCallback(
    async (yaml: string) => {
      if (staticMode) {
        const parsed = YAML.parse(yaml) as TopologyScenario;
        await updateScenarioConfig(parsed);
        return;
      }
      if (!token) {
        return;
      }
      setIsConnecting(true);
      try {
        const nextSnapshot = await saveScenarioYaml(token, yaml);
        setSnapshot(nextSnapshot);
        await refreshScenarioConfig(token);
        setError(undefined);
      } catch (reason) {
        setError((reason as Error).message);
        throw reason;
      } finally {
        setIsConnecting(false);
      }
    },
    [refreshScenarioConfig, token, updateScenarioConfig]
  );

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
    if (staticMode || !token) {
      return;
    }
    let cancelled = false;
    setIsConnecting(true);
    Promise.all([fetchTopology(token), refreshScenarioConfig(token)])
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
        if (reason.message.startsWith("401")) {
          signOut();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsConnecting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshScenarioConfig, signOut, token]);

  useEffect(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = undefined;
    if (staticMode || !token || paused) {
      return;
    }

    const events = new EventSource(`${apiBaseUrl}/api/live?token=${encodeURIComponent(token)}`);
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
  }, [paused, token]);

  return useMemo(
    () => ({
      token,
      isAuthenticated,
      snapshot,
      catalog,
      scenarioConfig,
      scenarios,
      activeScenarioId,
      error,
      paused,
      isConnecting,
      signIn,
      signOut,
      setPaused,
      changeScenario,
      updateScenarioConfig,
      loadScenarioYaml,
      updateScenarioYaml
    }),
    [
      activeScenarioId,
      catalog,
      changeScenario,
      error,
      isAuthenticated,
      isConnecting,
      loadScenarioYaml,
      paused,
      scenarioConfig,
      scenarios,
      signIn,
      signOut,
      snapshot,
      token,
      updateScenarioConfig,
      updateScenarioYaml
    ]
  );
}
