import { useMemo } from "react";
import { formatRate, type TopologyNode, type TopologySnapshot } from "@solace-topology/shared";
import { Database, X } from "lucide-react";
import { selectionDetailSections } from "../lib/details.js";

interface RightPanelProps {
  snapshot: TopologySnapshot;
  selected?: TopologyNode;
  onSelect: (item: TopologyNode | undefined) => void;
}

function displayMetadataKey(key: string): string {
  if (key === "role") {
    return "role";
  }
  if (key === "messagingProtocol") {
    return "protocol";
  }
  if (key === "messagingProtocols") {
    return "protocols";
  }
  if (key === "amqpUrl") {
    return "AMQP endpoint";
  }
  return key;
}

function displayMetadataValue(key: string, value: string | number | boolean | string[] | undefined): string {
  if (key === "role") {
    if (value === "emitter") {
      return "publisher";
    }
    if (value === "listener") {
      return "subscriber";
    }
    if (value === "both") {
      return "publisher / subscriber";
    }
  }
  if (key === "messagingProtocol" && typeof value === "string") {
    return value.toUpperCase();
  }
  if (key === "messagingProtocols" && Array.isArray(value)) {
    return value.map((item) => item.toUpperCase()).join(", ");
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function RightPanel({ snapshot, selected, onSelect }: RightPanelProps) {
  const detailSections = useMemo(() => (selected ? selectionDetailSections(snapshot, selected) : []), [selected, snapshot]);

  return (
    <aside className="right-panel" aria-label="Topology details">
      <section className="detail-drawer open" aria-label="Selected element details">
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
                  <dt>{displayMetadataKey(key)}</dt>
                  <dd>{displayMetadataValue(key, value)}</dd>
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
        ) : (
          <div className="empty-detail">
            <Database size={22} />
            <h2>Route Details</h2>
            <p>Select a publisher, broker, or subscriber to show the active event path.</p>
          </div>
        )}
      </section>
    </aside>
  );
}
