import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { EventPortalConfig, TopologyNode, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";
import { ArrowLeft, BookOpenCheck, CheckCircle2, CloudCog, Database, FileCode2, RadioTower, Save, Search, ServerCog, Tags } from "lucide-react";
import { BrokerSettingsPanel } from "./BrokerSettingsPanel.js";
import type { BrokerRecord } from "../lib/brokerRegistry.js";

interface SettingsPageProps {
  snapshot: TopologySnapshot;
  scenarioConfig?: TopologyScenario;
  isConnecting: boolean;
  onClose: () => void;
  onSelect: (item: TopologyNode | undefined) => void;
  onSaveBroker: (broker: BrokerRecord) => void;
  onRemoveBroker: (brokerId: string) => void;
  onSaveScenario: (scenario: TopologyScenario) => Promise<void>;
  loadScenarioYaml: () => Promise<string>;
  onSaveYaml: (yaml: string) => Promise<void>;
}

const emptyEventPortal: EventPortalConfig = {
  enabled: false,
  baseUrl: "https://api.solace.cloud",
  tokenEnv: "EVENT_PORTAL_API_TOKEN",
  applicationDomainId: "",
  environmentId: "",
  syncMode: "metadata-only"
};

function roleName(role: string): string {
  if (role === "emitter") {
    return "Publisher";
  }
  if (role === "listener") {
    return "Subscriber";
  }
  return "Publisher / Subscriber";
}

function compactList(values: string[] | undefined): string {
  return values?.length ? values.join(", ") : "Not mapped";
}

function eventPortalReady(config: EventPortalConfig): boolean {
  return Boolean(config.enabled && config.baseUrl && (config.tokenEnv || config.token) && config.applicationDomainId);
}

function normalizeEventPortal(config: EventPortalConfig): EventPortalConfig {
  return {
    enabled: Boolean(config.enabled),
    baseUrl: config.baseUrl.trim() || "https://api.solace.cloud",
    tokenEnv: config.tokenEnv?.trim() || undefined,
    token: config.token || undefined,
    applicationDomainId: config.applicationDomainId?.trim() || undefined,
    environmentId: config.environmentId?.trim() || undefined,
    syncMode: config.syncMode ?? "metadata-only"
  };
}

export function SettingsPage({
  snapshot,
  scenarioConfig,
  isConnecting,
  onClose,
  onSelect,
  onSaveBroker,
  onRemoveBroker,
  onSaveScenario,
  loadScenarioYaml,
  onSaveYaml
}: SettingsPageProps) {
  const [eventPortalDraft, setEventPortalDraft] = useState<EventPortalConfig>(scenarioConfig?.eventPortal ?? emptyEventPortal);
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlError, setYamlError] = useState("");
  const [yamlSaved, setYamlSaved] = useState("");
  const [eventPortalSaved, setEventPortalSaved] = useState("");

  useEffect(() => {
    setEventPortalDraft(scenarioConfig?.eventPortal ?? emptyEventPortal);
  }, [scenarioConfig?.eventPortal, scenarioConfig?.id]);

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
    await onSaveScenario({
      ...scenarioConfig,
      eventPortal: normalizeEventPortal(eventPortalDraft)
    });
    setEventPortalSaved("Saved");
  }

  function submitEventPortal(event: FormEvent) {
    event.preventDefault();
    void saveEventPortal();
  }

  async function saveYaml() {
    try {
      await onSaveYaml(yamlDraft);
      setYamlError("");
      setYamlSaved("Saved and reconnected");
    } catch (reason) {
      setYamlSaved("");
      setYamlError((reason as Error).message);
    }
  }

  const portalReady = eventPortalReady(eventPortalDraft);

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-hero">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Connectivity and Metadata Setup</h2>
          <p>Configure broker access, Event Portal metadata, runtime discovery, and the scenario YAML needed to make the topology useful for customers.</p>
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
          <Tags size={18} />
          <span>Metadata</span>
          <strong>
            {discovered.publishers.length} publishers / {discovered.subscribers.length} subscribers
          </strong>
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
                <input value={eventPortalDraft.baseUrl} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, baseUrl: event.target.value })} />
              </label>
              <label>
                API token environment variable
                <input value={eventPortalDraft.tokenEnv ?? ""} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, tokenEnv: event.target.value })} />
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
                <input value={eventPortalDraft.applicationDomainId ?? ""} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, applicationDomainId: event.target.value })} />
              </label>
              <label>
                Environment ID
                <input value={eventPortalDraft.environmentId ?? ""} onChange={(event) => setEventPortalDraft({ ...eventPortalDraft, environmentId: event.target.value })} />
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
              <p>Application names, provenance, ownership, topic intent, and chargeback data come from Event Portal, YAML, or customer systems.</p>
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
              <strong>4. Governance source</strong>
              <span>Optional Event Portal connection for application/event/topic intent, with YAML as override.</span>
            </div>
          </div>
        </section>

        <section className="settings-panel yaml-settings-panel" aria-label="Scenario YAML editor">
          <div className="section-title-row">
            <div>
              <h2>YAML Config</h2>
              <p>Edit the complete active scenario when bulk changes are faster than the visual forms.</p>
            </div>
            <FileCode2 size={20} />
          </div>
          <div className="yaml-editor-grid">
            <textarea value={yamlDraft} onChange={(event) => setYamlDraft(event.target.value)} spellCheck={false} />
            <aside className="yaml-assist" aria-label="YAML editing guide">
              <h3>Editing Guide</h3>
              <dl>
                <div>
                  <dt>Broker</dt>
                  <dd>Set `managementUrl`, `messageVpns`, auth, TLS, site, region, and physical location.</dd>
                </div>
                <div>
                  <dt>Event Portal</dt>
                  <dd>Set `eventPortal.baseUrl`, `tokenEnv`, domain ID, environment ID, and sync mode.</dd>
                </div>
                <div>
                  <dt>Publisher</dt>
                  <dd>Use one broker, client or username matchers, and publish topic prefixes.</dd>
                </div>
                <div>
                  <dt>Subscriber</dt>
                  <dd>Use one broker, queue matchers, queues, and topic prefixes that match publishers.</dd>
                </div>
              </dl>
            </aside>
          </div>
          {yamlError ? <div className="form-error">{yamlError}</div> : null}
          <div className="settings-actions">
            <button onClick={() => void saveYaml()} disabled={isConnecting}>
              <Save size={15} />
              Save YAML and Connect
            </button>
            {yamlSaved ? <span>{yamlSaved}</span> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
