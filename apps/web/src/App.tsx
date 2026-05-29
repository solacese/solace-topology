import { useState } from "react";
import type { TopologyNode, TopologyScenario } from "@solace-topology/shared";
import { Network, Settings } from "lucide-react";
import { RightPanel } from "./components/RightPanel.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { Toolbar } from "./components/Toolbar.js";
import { TopologyGraph, type SortMode } from "./components/TopologyGraph.js";
import { useTopology } from "./hooks/useTopology.js";
import { brokerConfigFromRecord, type BrokerRecord } from "./lib/brokerRegistry.js";
import type { GraphFilters } from "./lib/graph.js";

export function App() {
  const topology = useTopology();
  const [selected, setSelected] = useState<TopologyNode | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("type");
  const [filters, setFilters] = useState<GraphFilters>({
    search: "",
    provenances: new Set()
  });

  async function saveBroker(record: BrokerRecord) {
    if (!topology.scenarioConfig) {
      return;
    }
    const existing = topology.scenarioConfig.brokers.find((broker) => broker.id === record.id);
    const nextBroker = brokerConfigFromRecord(record, existing);
    const nextScenario: TopologyScenario = {
      ...topology.scenarioConfig,
      brokers: existing
        ? topology.scenarioConfig.brokers.map((broker) => (broker.id === record.id ? nextBroker : broker))
        : [...topology.scenarioConfig.brokers, nextBroker]
    };
    await topology.updateScenarioConfig(nextScenario);
  }

  async function removeBroker(brokerId: string) {
    if (!topology.scenarioConfig) {
      return;
    }
    const nextScenario: TopologyScenario = {
      ...topology.scenarioConfig,
      brokers: topology.scenarioConfig.brokers.filter((broker) => broker.id !== brokerId),
      links: topology.scenarioConfig.links.filter((link) => link.from !== brokerId && link.to !== brokerId),
      applications: topology.scenarioConfig.applications.map((app) => ({
        ...app,
        brokerIds: app.brokerIds.filter((id) => id !== brokerId)
      }))
    };
    if (selected?.id === `broker:${brokerId}`) {
      setSelected(undefined);
    }
    await topology.updateScenarioConfig(nextScenario);
  }

  if (!topology.snapshot) {
    return (
      <main className="loading-screen">
        <div className="loader" />
        <p>{topology.error ?? "Loading topology..."}</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <div className="brand-mark small">
            <Network size={23} />
          </div>
          <div>
            <h1>Solace Topology</h1>
          </div>
        </div>
        <div className="header-actions">
          <label className="scenario-select">
            <span>Case</span>
            <select value={topology.activeScenarioId} onChange={(event) => void topology.changeScenario(event.target.value)}>
              {topology.scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </label>
          <button className={settingsOpen ? "top-action active" : "top-action"} onClick={() => setSettingsOpen((open) => !open)}>
            <Settings size={16} />
            Settings
          </button>
        </div>
      </header>

      {topology.error ? <div className="app-alert">{topology.error}</div> : null}

      {settingsOpen ? (
        <SettingsPage
          snapshot={topology.snapshot}
          scenarioConfig={topology.scenarioConfig}
          isConnecting={topology.isConnecting}
          isStaticMode={topology.isStaticMode}
          onClose={() => setSettingsOpen(false)}
          onSelect={setSelected}
          onSaveBroker={(record) => void saveBroker(record)}
          onRemoveBroker={(brokerId) => void removeBroker(brokerId)}
          onSaveScenario={topology.updateScenarioConfig}
          loadScenarioYaml={topology.loadScenarioYaml}
          onSaveYaml={topology.updateScenarioYaml}
          onSuggestMappings={topology.suggestMappings}
        />
      ) : (
        <>
          <Toolbar snapshot={topology.snapshot} filters={filters} sortMode={sortMode} onFiltersChange={setFilters} onSortModeChange={setSortMode} />

          <section className="workspace has-detail">
            <TopologyGraph snapshot={topology.snapshot} filters={filters} sortMode={sortMode} selectedId={selected?.id} onSelect={setSelected} />
            <RightPanel snapshot={topology.snapshot} selected={selected} onSelect={setSelected} />
          </section>
        </>
      )}
    </main>
  );
}
