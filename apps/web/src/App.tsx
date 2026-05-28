import { useState } from "react";
import type { TopologyNode, TopologyScenario } from "@solace-topology/shared";
import { FileCode2, Network, Save, Settings, X } from "lucide-react";
import { BrokerSettingsPanel } from "./components/BrokerSettingsPanel.js";
import { RightPanel } from "./components/RightPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import { TopologyGraph, type SortMode } from "./components/TopologyGraph.js";
import { useTopology } from "./hooks/useTopology.js";
import { brokerConfigFromRecord, type BrokerRecord } from "./lib/brokerRegistry.js";
import type { GraphFilters } from "./lib/graph.js";

export function App() {
  const topology = useTopology();
  const [selected, setSelected] = useState<TopologyNode | undefined>();
  const [yamlOpen, setYamlOpen] = useState(false);
  const [brokerSettingsOpen, setBrokerSettingsOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("type");
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlError, setYamlError] = useState("");
  const [filters, setFilters] = useState<GraphFilters>({
    search: "",
    provenances: new Set()
  });

  async function toggleYamlEditor() {
    if (yamlOpen) {
      setYamlOpen(false);
      return;
    }
    setYamlError("");
    setYamlDraft(await topology.loadScenarioYaml());
    setYamlOpen(true);
  }

  async function saveYamlEditor() {
    try {
      await topology.updateScenarioYaml(yamlDraft);
      setYamlOpen(false);
      setYamlError("");
      setSelected(undefined);
    } catch (reason) {
      setYamlError((reason as Error).message);
    }
  }

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
          <button className="top-action" onClick={() => setBrokerSettingsOpen((open) => !open)}>
            <Settings size={16} />
            Broker Settings
          </button>
          <button className={yamlOpen ? "top-action active" : "top-action"} onClick={() => void toggleYamlEditor()}>
            <FileCode2 size={16} />
            YAML Config
          </button>
        </div>
      </header>

      {topology.error ? <div className="app-alert">{topology.error}</div> : null}

      {brokerSettingsOpen ? (
        <BrokerSettingsPanel
          snapshot={topology.snapshot}
          scenarioConfig={topology.scenarioConfig}
          onSelect={setSelected}
          onSaveBroker={(record) => void saveBroker(record)}
          onRemoveBroker={(brokerId) => void removeBroker(brokerId)}
        />
      ) : null}

      {yamlOpen ? (
        <section className="yaml-editor-panel" aria-label="Scenario YAML editor">
          <div className="section-title-row">
            <h2>Edit Active Scenario YAML Config</h2>
            <button className="icon-button small" onClick={() => setYamlOpen(false)} aria-label="Close YAML editor">
              <X size={16} />
            </button>
          </div>
          <textarea value={yamlDraft} onChange={(event) => setYamlDraft(event.target.value)} spellCheck={false} />
          {yamlError ? <div className="form-error">{yamlError}</div> : null}
          <div className="yaml-actions">
            <button onClick={() => void saveYamlEditor()}>
              <Save size={15} />
              Save and Connect
            </button>
            <button onClick={() => setYamlOpen(false)}>Cancel</button>
          </div>
        </section>
      ) : null}

      <Toolbar snapshot={topology.snapshot} filters={filters} sortMode={sortMode} onFiltersChange={setFilters} onSortModeChange={setSortMode} />

      <section className="workspace has-detail">
        <TopologyGraph snapshot={topology.snapshot} filters={filters} sortMode={sortMode} selectedId={selected?.id} onSelect={setSelected} />
        <RightPanel snapshot={topology.snapshot} selected={selected} onSelect={setSelected} />
      </section>
    </main>
  );
}
