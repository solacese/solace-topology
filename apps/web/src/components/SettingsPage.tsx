import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import YAML from "yaml";
import type { AiAssistantConfig, EventPortalConfig, MappingSuggestionsResponse, TopologyNode, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";
import { ArrowLeft, BookOpenCheck, Bot, CheckCircle2, CloudCog, Database, FileCode2, ListTree, RadioTower, Save, Search, ServerCog, Sparkles, Tags } from "lucide-react";
import { BrokerSettingsPanel } from "./BrokerSettingsPanel.js";
import type { BrokerRecord } from "../lib/brokerRegistry.js";

interface SettingsPageProps {
  snapshot: TopologySnapshot;
  scenarioConfig?: TopologyScenario;
  isConnecting: boolean;
  isStaticMode: boolean;
  onClose: () => void;
  onSelect: (item: TopologyNode | undefined) => void;
  onSaveBroker: (broker: BrokerRecord) => void;
  onRemoveBroker: (brokerId: string) => void;
  onSaveScenario: (scenario: TopologyScenario) => Promise<void>;
  loadScenarioYaml: () => Promise<string>;
  onSaveYaml: (yaml: string) => Promise<void>;
  onSuggestMappings: () => Promise<MappingSuggestionsResponse>;
}

type YamlSectionId = "overview" | "brokers" | "eventPortal" | "aiAssistant" | "ownership" | "applications" | "full";

const emptyEventPortal: EventPortalConfig = {
  enabled: false,
  baseUrl: "https://api.solace.cloud",
  tokenEnv: "EVENT_PORTAL_API_TOKEN",
  applicationDomainId: "",
  environmentId: "",
  syncMode: "metadata-only"
};

const emptyAiAssistant: AiAssistantConfig = {
  enabled: false,
  baseUrl: "http://localhost:4000",
  apiKeyEnv: "LITELLM_API_KEY",
  model: "gpt-4o-mini",
  temperature: 0.2
};

const yamlSections: Array<{ id: YamlSectionId; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "Scenario identity and display text." },
  { id: "brokers", label: "Brokers", description: "Broker inventory, physical location, and broker-to-broker links." },
  { id: "eventPortal", label: "Event Portal", description: "Governed metadata source for applications, events, schemas, and topic intent." },
  { id: "aiAssistant", label: "AI Helper", description: "LiteLLM proxy settings for mapping suggestions." },
  { id: "ownership", label: "Ownership", description: "Owners and cost centers used for planning and chargeback views." },
  { id: "applications", label: "Applications", description: "Publishers, subscribers, matchers, queues, and topic mappings." },
  { id: "full", label: "Full YAML", description: "The complete active scenario for bulk edits." }
];

function roleName(role: string): string {
  if (role === "emitter") {
    return "Publisher";
  }
  if (role === "listener") {
    return "Subscriber";
  }
  return "Publisher / Subscriber";
}

function protocolName(protocol: string | undefined): string {
  return (protocol ?? "amqp").toUpperCase();
}

function compactList(values: string[] | undefined): string {
  return values?.length ? values.join(", ") : "Not mapped";
}

function yamlString(value: unknown): string {
  return YAML.stringify(value, { lineWidth: 140 });
}

function eventPortalReady(config: EventPortalConfig): boolean {
  return Boolean(config.enabled && config.baseUrl && (config.tokenEnv || config.token) && config.applicationDomainId);
}

function aiReady(config: AiAssistantConfig): boolean {
  return Boolean(config.enabled && config.baseUrl && config.model);
}

function normalizeEventPortal(config: Partial<EventPortalConfig> | undefined): EventPortalConfig {
  return {
    enabled: Boolean(config?.enabled),
    baseUrl: config?.baseUrl?.trim() || "https://api.solace.cloud",
    tokenEnv: config?.tokenEnv?.trim() || undefined,
    token: config?.token || undefined,
    applicationDomainId: config?.applicationDomainId?.trim() || undefined,
    environmentId: config?.environmentId?.trim() || undefined,
    syncMode: config?.syncMode ?? "metadata-only"
  };
}

function normalizeAiAssistant(config: Partial<AiAssistantConfig> | undefined): AiAssistantConfig {
  const temperature = typeof config?.temperature === "number" && Number.isFinite(config.temperature) ? config.temperature : 0.2;
  return {
    enabled: Boolean(config?.enabled),
    baseUrl: config?.baseUrl?.trim() || "http://localhost:4000",
    apiKeyEnv: config?.apiKeyEnv?.trim() || undefined,
    apiKey: config?.apiKey || undefined,
    model: config?.model?.trim() || "gpt-4o-mini",
    temperature
  };
}

function sectionValue(scenario: TopologyScenario | undefined, sectionId: YamlSectionId, fullYaml: string): string {
  if (!scenario) {
    return sectionId === "full" ? fullYaml : "";
  }
  if (sectionId === "full") {
    return fullYaml || yamlString(scenario);
  }
  if (sectionId === "overview") {
    return yamlString({ id: scenario.id, name: scenario.name, display: scenario.display });
  }
  if (sectionId === "brokers") {
    return yamlString({ brokers: scenario.brokers, links: scenario.links });
  }
  if (sectionId === "eventPortal") {
    return yamlString({ eventPortal: scenario.eventPortal ?? emptyEventPortal });
  }
  if (sectionId === "aiAssistant") {
    return yamlString({ aiAssistant: scenario.aiAssistant ?? emptyAiAssistant });
  }
  if (sectionId === "ownership") {
    return yamlString({ owners: scenario.owners, costCenters: scenario.costCenters });
  }
  return yamlString({ applications: scenario.applications });
}

function mergeScenarioSection(current: TopologyScenario, sectionId: YamlSectionId, source: string): TopologyScenario {
  const parsed = (YAML.parse(source) ?? {}) as Partial<TopologyScenario>;
  if (sectionId === "full") {
    return parsed as TopologyScenario;
  }
  if (sectionId === "overview") {
    return {
      ...current,
      id: typeof parsed.id === "string" ? parsed.id : current.id,
      name: typeof parsed.name === "string" ? parsed.name : current.name,
      display: parsed.display ?? current.display
    };
  }
  if (sectionId === "brokers") {
    return {
      ...current,
      brokers: Array.isArray(parsed.brokers) ? parsed.brokers : current.brokers,
      links: Array.isArray(parsed.links) ? parsed.links : current.links
    };
  }
  if (sectionId === "eventPortal") {
    return {
      ...current,
      eventPortal: normalizeEventPortal((parsed.eventPortal ?? emptyEventPortal) as EventPortalConfig)
    };
  }
  if (sectionId === "aiAssistant") {
    return {
      ...current,
      aiAssistant: normalizeAiAssistant((parsed.aiAssistant ?? emptyAiAssistant) as AiAssistantConfig)
    };
  }
  if (sectionId === "ownership") {
    return {
      ...current,
      owners: Array.isArray(parsed.owners) ? parsed.owners : current.owners,
      costCenters: Array.isArray(parsed.costCenters) ? parsed.costCenters : current.costCenters
    };
  }
  return {
    ...current,
    applications: Array.isArray(parsed.applications) ? parsed.applications : current.applications
  };
}

export function SettingsPage({
  snapshot,
  scenarioConfig,
  isConnecting,
  isStaticMode,
  onClose,
  onSelect,
  onSaveBroker,
  onRemoveBroker,
  onSaveScenario,
  loadScenarioYaml,
  onSaveYaml,
  onSuggestMappings
}: SettingsPageProps) {
  const [eventPortalDraft, setEventPortalDraft] = useState<EventPortalConfig>(scenarioConfig?.eventPortal ?? emptyEventPortal);
  const [aiDraft, setAiDraft] = useState<AiAssistantConfig>(scenarioConfig?.aiAssistant ?? emptyAiAssistant);
  const [yamlSection, setYamlSection] = useState<YamlSectionId>("overview");
  const [yamlDraft, setYamlDraft] = useState("");
  const [sectionDraft, setSectionDraft] = useState("");
  const [yamlError, setYamlError] = useState("");
  const [yamlSaved, setYamlSaved] = useState("");
  const [eventPortalSaved, setEventPortalSaved] = useState("");
  const [aiSaved, setAiSaved] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<MappingSuggestionsResponse | undefined>();

  useEffect(() => {
    setEventPortalDraft(scenarioConfig?.eventPortal ?? emptyEventPortal);
    setAiDraft(scenarioConfig?.aiAssistant ?? emptyAiAssistant);
  }, [scenarioConfig?.eventPortal, scenarioConfig?.aiAssistant, scenarioConfig?.id]);

  useEffect(() => {
    let cancelled = false;
    setYamlError("");
    setYamlSaved("");
    loadScenarioYaml()
      .then((yaml) => {
        if (!cancelled) {
          setYamlDraft(yaml);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setYamlError(reason.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadScenarioYaml, scenarioConfig?.id]);

  useEffect(() => {
    setSectionDraft(sectionValue(scenarioConfig, yamlSection, yamlDraft));
  }, [scenarioConfig, yamlDraft, yamlSection]);

  const discovered = useMemo(() => {
    const queues = snapshot.nodes.filter((node) => node.type === "Queue");
    const topics = snapshot.nodes.filter((node) => node.type === "TopicPattern");
    const subscriptions = snapshot.edges.filter((edge) => edge.type === "SUBSCRIBES_TO");
    const publishers = snapshot.nodes.filter((node) => node.type === "Application" && ["emitter", "both"].includes(String(node.metadata?.role ?? "")));
    const subscribers = snapshot.nodes.filter((node) => node.type === "Application" && ["listener", "both"].includes(String(node.metadata?.role ?? "")));
    return { queues, topics, subscriptions, publishers, subscribers };
  }, [snapshot.edges, snapshot.nodes]);

  const metadataGaps = useMemo(() => {
    if (!scenarioConfig) {
      return {
        brokersMissingLocation: 0,
        publishersMissingMatchers: 0,
        subscribersMissingQueues: 0,
        subscribersMissingTopics: 0
      };
    }
    return {
      brokersMissingLocation: scenarioConfig.brokers.filter((broker) => !broker.physicalLocation && !broker.site).length,
      publishersMissingMatchers: scenarioConfig.applications.filter((app) => ["emitter", "both"].includes(app.role) && !app.clientMatchers?.length && !app.usernameMatchers?.length).length,
      subscribersMissingQueues: scenarioConfig.applications.filter((app) => ["listener", "both"].includes(app.role) && !app.queueMatchers?.length && !app.listen?.queues?.length).length,
      subscribersMissingTopics: scenarioConfig.applications.filter((app) => ["listener", "both"].includes(app.role) && !app.listen?.topicPrefixes?.length).length
    };
  }, [scenarioConfig]);

  async function saveEventPortal() {
    if (!scenarioConfig) {
      return;
    }
    const nextEventPortal = normalizeEventPortal(eventPortalDraft);
    await onSaveScenario({
      ...scenarioConfig,
      eventPortal: nextEventPortal
    });
    setEventPortalDraft(nextEventPortal);
    setEventPortalSaved("Saved");
  }

  function submitEventPortal(event: FormEvent) {
    event.preventDefault();
    void saveEventPortal();
  }

  async function saveAiAssistant() {
    if (!scenarioConfig) {
      return;
    }
    const nextAiAssistant = normalizeAiAssistant(aiDraft);
    await onSaveScenario({
      ...scenarioConfig,
      aiAssistant: nextAiAssistant
    });
    setAiDraft(nextAiAssistant);
    setAiSaved("Saved");
    setAiError("");
  }

  function submitAiAssistant(event: FormEvent) {
    event.preventDefault();
    void saveAiAssistant();
  }

  async function runAiHelper() {
    setAiLoading(true);
    setAiError("");
    try {
      setAiSuggestion(await onSuggestMappings());
    } catch (reason) {
      setAiSuggestion(undefined);
      setAiError((reason as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  async function saveYamlSection() {
    if (!scenarioConfig) {
      return;
    }
    try {
      if (yamlSection === "full") {
        await onSaveYaml(sectionDraft);
        setYamlDraft(sectionDraft);
      } else {
        const nextScenario = mergeScenarioSection(scenarioConfig, yamlSection, sectionDraft);
        await onSaveScenario(nextScenario);
        setYamlDraft(yamlString(nextScenario));
        if (yamlSection === "eventPortal") {
          setEventPortalDraft(nextScenario.eventPortal ?? emptyEventPortal);
        }
        if (yamlSection === "aiAssistant") {
          setAiDraft(nextScenario.aiAssistant ?? emptyAiAssistant);
        }
      }
      setYamlError("");
      setYamlSaved("Saved and reconnected");
    } catch (reason) {
      setYamlSaved("");
      setYamlError((reason as Error).message);
    }
  }

  const portalReady = eventPortalReady(eventPortalDraft);
  const assistantReady = aiReady(aiDraft);
  const selectedYamlSection = yamlSections.find((section) => section.id === yamlSection) ?? yamlSections[0]!;

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-hero">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Connectivity and Metadata Setup</h2>
          <p>Configure broker access, Event Portal metadata, runtime discovery, YAML sections, and optional AI-assisted mapping for customer deployments.</p>
        </div>
        <button className="top-action" onClick={onClose}>
          <ArrowLeft size={16} />
          Back to Topology
        </button>
      </div>

      <div className="settings-readiness" aria-label="Setup readiness">
        <div>
          <ServerCog size={18} />
          <span>Broker Access</span>
          <strong>
            {snapshot.brokerStatuses.filter((broker) => broker.status === "connected" || broker.status === "sample").length}/{snapshot.brokerStatuses.length} live
          </strong>
        </div>
        <div>
          <CloudCog size={18} />
          <span>Event Portal</span>
          <strong>{portalReady ? "Ready" : "Optional"}</strong>
        </div>
        <div>
          <Bot size={18} />
          <span>AI Helper</span>
          <strong>{assistantReady ? "LiteLLM ready" : "Optional"}</strong>
        </div>
        <div>
          <Database size={18} />
          <span>Discovered</span>
          <strong>
            {discovered.queues.length} queues / {discovered.subscriptions.length} subscriptions
          </strong>
        </div>
      </div>

      <div className="settings-grid">
        <BrokerSettingsPanel snapshot={snapshot} scenarioConfig={scenarioConfig} onSelect={onSelect} onSaveBroker={onSaveBroker} onRemoveBroker={onRemoveBroker} />

        <section className="settings-panel event-portal-panel" aria-label="Event Portal setup">
          <div className="section-title-row">
            <div>
              <h2>Event Portal Metadata Source</h2>
              <p>Use Event Portal for governed application, event, schema, and topic intent. YAML remains the local override layer.</p>
            </div>
            <span className={portalReady ? "settings-status ready" : "settings-status"}>{portalReady ? "Ready for sync" : "Not connected"}</span>
          </div>
          <form className="event-portal-form" onSubmit={submitEventPortal}>
            <div className="settings-form-grid">
              <label className="checkbox-row">
                <input type="checkbox" checked={eventPortalDraft.enabled} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, enabled: event.target.checked })} />
                Enable Event Portal metadata
              </label>
              <label>
                Event Portal API base URL
                <input autoComplete="url" value={eventPortalDraft.baseUrl} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, baseUrl: event.target.value })} />
              </label>
              <label>
                API token environment variable
                <input autoComplete="off" value={eventPortalDraft.tokenEnv ?? ""} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, tokenEnv: event.target.value })} />
              </label>
              <label>
                Local API token
                <input
                  type="password"
                  autoComplete="current-password"
                  value={eventPortalDraft.token ?? ""}
                  onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, token: event.target.value })}
                  placeholder="Prefer an env var for production"
                />
              </label>
              <label>
                Application domain ID
                <input autoComplete="off" value={eventPortalDraft.applicationDomainId ?? ""} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, applicationDomainId: event.target.value })} />
              </label>
              <label>
                Environment ID
                <input autoComplete="off" value={eventPortalDraft.environmentId ?? ""} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, environmentId: event.target.value })} />
              </label>
              <label>
                Sync mode
                <select value={eventPortalDraft.syncMode ?? "metadata-only"} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, syncMode: event.target.value as EventPortalConfig["syncMode"] })}>
                  <option value="metadata-only">Metadata only</option>
                  <option value="read-only">Read-only import</option>
                </select>
              </label>
            </div>
            <div className="settings-actions">
              <button type="submit" disabled={!scenarioConfig || isConnecting}>
                <Save size={15} />
                Save Event Portal Source
              </button>
              {eventPortalSaved ? <span>{eventPortalSaved}</span> : null}
            </div>
          </form>
        </section>

        <section className="settings-panel ai-helper-panel" aria-label="AI mapping helper">
          <div className="section-title-row">
            <div>
              <h2>AI Mapping Helper</h2>
              <p>Connect a LiteLLM proxy to review discovered runtime data and suggest metadata matchers, topic mappings, and YAML patches.</p>
            </div>
            <span className={assistantReady ? "settings-status ready" : "settings-status"}>{assistantReady ? "Ready" : "Not configured"}</span>
          </div>
          <form className="ai-helper-form" onSubmit={submitAiAssistant}>
            <div className="settings-form-grid">
              <label className="checkbox-row">
                <input type="checkbox" checked={aiDraft.enabled} onChange={(event) => setAiDraft({ ...aiDraft, enabled: event.target.checked })} />
                Enable LiteLLM helper
              </label>
              <label>
                LiteLLM base URL
                <input autoComplete="url" value={aiDraft.baseUrl} onChange={(event) => setAiDraft({ ...aiDraft, baseUrl: event.target.value })} />
              </label>
              <label>
                Model
                <input autoComplete="off" value={aiDraft.model} onChange={(event) => setAiDraft({ ...aiDraft, model: event.target.value })} />
              </label>
              <label>
                API key environment variable
                <input autoComplete="off" value={aiDraft.apiKeyEnv ?? ""} onChange={(event) => setAiDraft({ ...aiDraft, apiKeyEnv: event.target.value })} />
              </label>
              <label>
                Local API key
                <input type="password" autoComplete="current-password" value={aiDraft.apiKey ?? ""} onChange={(event) => setAiDraft({ ...aiDraft, apiKey: event.target.value })} placeholder="Prefer an env var for production" />
              </label>
              <label>
                Temperature
                <input type="number" min="0" max="2" step="0.1" value={aiDraft.temperature ?? 0.2} onChange={(event) => setAiDraft({ ...aiDraft, temperature: Number(event.target.value) })} />
              </label>
            </div>
            <div className="settings-actions">
              <button type="submit" disabled={!scenarioConfig || isConnecting}>
                <Save size={15} />
                Save AI Helper
              </button>
              <button type="button" onClick={() => void runAiHelper()} disabled={isStaticMode || !assistantReady || aiLoading}>
                <Sparkles size={15} />
                {aiLoading ? "Reviewing..." : "Suggest Mapping"}
              </button>
              {aiSaved ? <span>{aiSaved}</span> : null}
            </div>
          </form>
          {isStaticMode ? <div className="helper-note">AI suggestions require the API runtime and a reachable LiteLLM proxy.</div> : null}
          {aiError ? <div className="form-error">{aiError}</div> : null}
          {aiSuggestion ? (
            <div className="ai-output">
              <strong>
                {aiSuggestion.model} / {new Date(aiSuggestion.generatedAt).toLocaleString()}
              </strong>
              <pre>{aiSuggestion.content}</pre>
            </div>
          ) : null}
        </section>

        <section className="settings-panel discovery-panel" aria-label="Discovered runtime inventory">
          <div className="section-title-row">
            <div>
              <h2>Discovered Runtime Inventory</h2>
              <p>Collected from broker SEMP polling. This proves what is live, but it does not replace business metadata.</p>
            </div>
            <BookOpenCheck size={20} />
          </div>
          <div className="discovery-grid">
            <div>
              <strong>Broker health</strong>
              {snapshot.brokerStatuses.map((broker) => (
                <span key={broker.brokerId}>
                  <RadioTower size={14} />
                  {broker.displayName} / {broker.status}
                </span>
              ))}
            </div>
            <div>
              <strong>Runtime objects</strong>
              <span>{discovered.queues.length} queues discovered</span>
              <span>{discovered.topics.length} topic patterns discovered</span>
              <span>{discovered.subscriptions.length} subscriptions discovered</span>
              <span>{snapshot.edges.filter((edge) => edge.type === "LINKED_TO").length} broker links configured</span>
            </div>
          </div>
        </section>

        <section className="settings-panel metadata-panel" aria-label="Metadata mapping">
          <div className="section-title-row">
            <div>
              <h2>Metadata Mapping</h2>
              <p>Application names, provenance, ownership, topic intent, and chargeback data come from Event Portal, YAML, customer systems, or the AI helper draft suggestions.</p>
            </div>
            <Search size={20} />
          </div>
          <div className="metadata-checks">
            <span className={metadataGaps.brokersMissingLocation ? "warning" : "ready"}>{metadataGaps.brokersMissingLocation} brokers missing location</span>
            <span className={metadataGaps.publishersMissingMatchers ? "warning" : "ready"}>{metadataGaps.publishersMissingMatchers} publishers missing client matchers</span>
            <span className={metadataGaps.subscribersMissingQueues ? "warning" : "ready"}>{metadataGaps.subscribersMissingQueues} subscribers missing queue mapping</span>
            <span className={metadataGaps.subscribersMissingTopics ? "warning" : "ready"}>{metadataGaps.subscribersMissingTopics} subscribers missing topic mapping</span>
          </div>
          <div className="settings-table" role="table" aria-label="Application metadata">
            <div role="row">
              <strong>Application</strong>
              <strong>Role</strong>
              <strong>Protocol</strong>
              <strong>Broker</strong>
              <strong>Runtime match</strong>
              <strong>Topics / queues</strong>
            </div>
            {(scenarioConfig?.applications ?? []).map((app) => (
              <div key={app.id} role="row">
                <span>
                  {app.displayName}
                  <small>{app.provenance}</small>
                </span>
                <span>{roleName(app.role)}</span>
                <span>{protocolName(app.messagingProtocol)}</span>
                <span>{compactList(app.brokerIds)}</span>
                <span>{compactList([...(app.clientMatchers ?? []), ...(app.usernameMatchers ?? []), ...(app.queueMatchers ?? [])])}</span>
                <span>{compactList([...(app.publishTopicPrefixes ?? []), ...(app.listen?.topicPrefixes ?? []), ...(app.listen?.queues ?? [])])}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-panel required-inputs-panel" aria-label="Required customer inputs">
          <div className="section-title-row">
            <div>
              <h2>Customer Setup Recipe</h2>
              <p>These are the minimum inputs needed for a useful production map.</p>
            </div>
            <CheckCircle2 size={20} />
          </div>
          <div className="recipe-list">
            <div>
              <strong>1. Broker connectivity</strong>
              <span>Management URL, VPN, SEMP auth, TLS/proxy path, site, region, and physical location.</span>
            </div>
            <div>
              <strong>2. Runtime discovery</strong>
              <span>SEMP read access for broker health, clients, queues, subscriptions, and live throughput.</span>
            </div>
            <div>
              <strong>3. Business metadata</strong>
              <span>Application identity, publisher topics, subscriber queues/topics, provenance, owner, and cost center.</span>
            </div>
            <div>
              <strong>4. Governance and AI</strong>
              <span>Optional Event Portal and LiteLLM connections for metadata import and mapping suggestions.</span>
            </div>
          </div>
        </section>

        <section className="settings-panel yaml-settings-panel" aria-label="Scenario YAML editor">
          <div className="section-title-row">
            <div>
              <h2>YAML Config</h2>
              <p>Edit focused YAML sections and save only that part of the active scenario, or switch to the full scenario for bulk edits.</p>
            </div>
            <FileCode2 size={20} />
          </div>
          <div className="yaml-section-tabs" role="tablist" aria-label="YAML sections">
            {yamlSections.map((section) => (
              <button key={section.id} className={yamlSection === section.id ? "active" : ""} onClick={() => setYamlSection(section.id)} type="button">
                <ListTree size={14} />
                {section.label}
              </button>
            ))}
          </div>
          <div className="yaml-editor-grid">
            <textarea value={sectionDraft} onChange={(event) => setSectionDraft(event.target.value)} spellCheck={false} />
            <aside className="yaml-assist" aria-label="YAML editing guide">
              <h3>{selectedYamlSection.label}</h3>
              <p>{selectedYamlSection.description}</p>
              <dl>
                <div>
                  <dt>Save behavior</dt>
                  <dd>{yamlSection === "full" ? "Validates and replaces the active scenario from the full YAML." : "Merges this section into the active scenario and reconnects."}</dd>
                </div>
                <div>
                  <dt>Production secrets</dt>
                  <dd>Prefer `usernameEnv`, `passwordEnv`, `sempApiKeyEnv`, `tokenEnv`, and `apiKeyEnv` over inline secrets.</dd>
                </div>
                <div>
                  <dt>AI helper</dt>
                  <dd>Use the LiteLLM panel to draft mapping suggestions, then apply accepted changes here.</dd>
                </div>
              </dl>
            </aside>
          </div>
          {yamlError ? <div className="form-error">{yamlError}</div> : null}
          <div className="settings-actions">
            <button onClick={() => void saveYamlSection()} disabled={isConnecting}>
              <Save size={15} />
              {yamlSection === "full" ? "Save Full YAML and Connect" : "Save Section and Connect"}
            </button>
            {yamlSaved ? <span>{yamlSaved}</span> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
