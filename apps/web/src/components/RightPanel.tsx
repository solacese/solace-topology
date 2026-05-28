import { FormEvent, useMemo, useState } from "react";
import { formatRate, type TopologyScenario, type TopologyNode, type TopologySnapshot } from "@solace-topology/shared";
import { Database, Pencil, Plus, RadioTower, Save, Trash2, X } from "lucide-react";
import { brokerRecordFromConfig, brokerRecordFromNode, statusLabel, type BrokerRecord } from "../lib/brokerRegistry.js";
import { selectionDetailSections } from "../lib/details.js";

interface RightPanelProps {
  snapshot: TopologySnapshot;
  scenarioConfig?: TopologyScenario;
  selected?: TopologyNode;
  onSelect: (item: TopologyNode | undefined) => void;
  onSaveBroker: (broker: BrokerRecord) => void;
  onRemoveBroker: (brokerId: string) => void;
}

function blankBroker(index: number): BrokerRecord {
  return {
    id: `broker-${index}`,
    displayName: `Broker ${index}`,
    managementUrl: "https://broker.example.com:943",
    messageVpn: "default",
    site: "New site",
    region: "Europe",
    physicalLocation: "Physical site",
    environment: "planning",
    authMode: "basic",
    username: "",
    password: "",
    sempApiKey: "",
    status: "connected"
  };
}

export function RightPanel({ snapshot, scenarioConfig, selected, onSelect, onSaveBroker, onRemoveBroker }: RightPanelProps) {
  const brokerNodes = useMemo(() => new Map(snapshot.nodes.filter((node) => node.type === "Broker").map((node) => [node.id, node])), [snapshot.nodes]);
  const brokerConfigs = useMemo(() => new Map((scenarioConfig?.brokers ?? []).map((broker) => [broker.id, broker])), [scenarioConfig?.brokers]);
  const detailSections = useMemo(() => (selected ? selectionDetailSections(snapshot, selected) : []), [selected, snapshot]);
  const [editing, setEditing] = useState<BrokerRecord | undefined>();
  const [editingOriginalId, setEditingOriginalId] = useState<string | undefined>();

  function startEdit(brokerId: string) {
    const node = brokerNodes.get(`broker:${brokerId}`);
    const status = snapshot.brokerStatuses.find((broker) => broker.brokerId === brokerId);
    if (node) {
      setEditingOriginalId(brokerId);
      setEditing(brokerConfigs.has(brokerId) ? brokerRecordFromConfig(brokerConfigs.get(brokerId)!, status) : brokerRecordFromNode(node, status));
    }
  }

  function submitBroker(event: FormEvent) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    onSaveBroker(editingOriginalId ? { ...editing, id: editingOriginalId } : editing);
    setEditingOriginalId(undefined);
    setEditing(undefined);
  }

  return (
    <aside className="right-panel" aria-label="Topology details">
      <div className="panel-section broker-health">
        <div className="section-title-row">
          <h2>Brokers</h2>
          <button
            className="icon-button small"
            onClick={() => {
              setEditingOriginalId(undefined);
              setEditing(blankBroker(snapshot.brokerStatuses.length + 1));
            }}
            aria-label="Add broker"
          >
            <Plus size={16} />
          </button>
        </div>
        {snapshot.brokerStatuses.map((broker) => (
          <div key={broker.brokerId} className={`broker-row ${broker.status}`}>
            <button className="broker-select" onClick={() => onSelect(snapshot.nodes.find((node) => node.id === `broker:${broker.brokerId}`))}>
              <RadioTower size={16} />
              <span>{broker.displayName}</span>
              <strong>{statusLabel(broker.status)}</strong>
            </button>
            <button className="icon-button small" onClick={() => startEdit(broker.brokerId)} aria-label={`Edit ${broker.displayName}`}>
              <Pencil size={15} />
            </button>
            <button className="icon-button small danger" onClick={() => onRemoveBroker(broker.brokerId)} aria-label={`Remove ${broker.displayName}`}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {editing ? (
          <form className="broker-editor" onSubmit={submitBroker}>
            <label>
              Broker id
              <input disabled={Boolean(editingOriginalId)} value={editing.id} onChange={(event) => setEditing({ ...editing, id: event.target.value })} />
            </label>
            <label>
              Display name
              <input value={editing.displayName} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} />
            </label>
            <label>
              SEMP management URL
              <input value={editing.managementUrl} onChange={(event) => setEditing({ ...editing, managementUrl: event.target.value })} />
            </label>
            <label>
              Message VPN
              <input value={editing.messageVpn} onChange={(event) => setEditing({ ...editing, messageVpn: event.target.value })} />
            </label>
            <label>
              Site
              <input value={editing.site} onChange={(event) => setEditing({ ...editing, site: event.target.value })} />
            </label>
            <label>
              Physical location
              <input value={editing.physicalLocation} onChange={(event) => setEditing({ ...editing, physicalLocation: event.target.value })} />
            </label>
            <label>
              Region
              <input value={editing.region} onChange={(event) => setEditing({ ...editing, region: event.target.value })} />
            </label>
            <label>
              Environment
              <input value={editing.environment} onChange={(event) => setEditing({ ...editing, environment: event.target.value })} />
            </label>
            <label>
              SEMP auth
              <select value={editing.authMode} onChange={(event) => setEditing({ ...editing, authMode: event.target.value as BrokerRecord["authMode"] })}>
                <option value="basic">Username / password</option>
                <option value="bearer">SEMP API key</option>
              </select>
            </label>
            {editing.authMode === "basic" ? (
              <>
                <label>
                  SEMP username
                  <input value={editing.username} onChange={(event) => setEditing({ ...editing, username: event.target.value })} />
                </label>
                <label>
                  SEMP password
                  <input type="password" value={editing.password} onChange={(event) => setEditing({ ...editing, password: event.target.value })} />
                </label>
              </>
            ) : (
              <label>
                SEMP API key
                <input type="password" value={editing.sempApiKey} onChange={(event) => setEditing({ ...editing, sempApiKey: event.target.value })} />
              </label>
            )}
            <label>
              Status
              <select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as BrokerRecord["status"] })}>
                <option value="connected">Live</option>
                <option value="degraded">Degraded</option>
                <option value="unreachable">Offline</option>
              </select>
            </label>
            <div className="broker-editor-actions">
              <button type="submit">
                <Save size={15} />
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingOriginalId(undefined);
                  setEditing(undefined);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>

      <section className={selected ? "detail-drawer open" : "detail-drawer"} aria-label="Selected element details">
        {selected ? (
          <>
            <button className="icon-button close" onClick={() => onSelect(undefined)} aria-label="Close details">
              <X size={18} />
            </button>
            <Database size={22} />
            <h2>{selected.label}</h2>
            <p>{selected.type}</p>
            <dl>
              <div>
                <dt>Message rate</dt>
                <dd>{formatRate(selected.metrics?.msgRate)}</dd>
              </div>
              <div>
                <dt>Byte rate</dt>
                <dd>{formatRate(selected.metrics?.byteRate, "B/s")}</dd>
              </div>
              {Object.entries(selected.metadata ?? {}).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd>
                </div>
              ))}
            </dl>
            {detailSections.map((section) => (
              <div className="detail-section" key={section.title}>
                <h3>{section.title}</h3>
                {section.items.length > 0 ? (
                  <ul>
                    {section.items.map((item) => (
                      <li key={`${section.title}-${item.title}-${item.detail}`}>
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No matching subscriptions found in this scenario.</p>
                )}
              </div>
            ))}
          </>
        ) : null}
      </section>
    </aside>
  );
}
