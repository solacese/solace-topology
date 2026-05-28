import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, Database, RadioTower, Send, UsersRound } from "lucide-react";
import { formatRate, type TopologyNode, type TopologySnapshot } from "@solace-topology/shared";
import { buildStructuredTopology, relatedApplicationIds, type GraphFilters, type StructuredLink } from "../lib/graph.js";

interface TopologyGraphProps {
  snapshot: TopologySnapshot;
  filters: GraphFilters;
  selectedId?: string;
  onSelect: (item: TopologyNode | undefined) => void;
}

interface RenderedLink extends StructuredLink {
  path: string;
  width: number;
  selected: boolean;
}

function roleLabel(role: string | undefined): string {
  if (role === "emitter") {
    return "Emitter";
  }
  if (role === "listener") {
    return "Listener";
  }
  return "Broker";
}

function NodeCard({
  node,
  tone,
  selected,
  onSelect,
  setNodeRef
}: {
  node: TopologyNode;
  tone: "emitter" | "broker" | "listener";
  selected: boolean;
  onSelect: (node: TopologyNode) => void;
  setNodeRef: (id: string) => (element: HTMLButtonElement | null) => void;
}) {
  const Icon = tone === "emitter" ? Send : tone === "listener" ? UsersRound : RadioTower;
  const provenance = String(node.metadata?.provenance ?? "");
  const location = tone === "broker" ? String(node.metadata?.physicalLocation ?? node.metadata?.site ?? "") : "";
  return (
    <button ref={setNodeRef(node.id)} className={`topology-node ${tone}${selected ? " selected" : ""}`} onClick={() => onSelect(node)}>
      <span className="node-icon">
        <Icon size={17} />
      </span>
      <span className="node-content">
        <strong>{node.label}</strong>
        <span>
          {location || `${roleLabel(String(node.metadata?.role ?? ""))}${provenance ? ` / ${provenance}` : ""}`}
        </span>
      </span>
      <span className="node-rate">{formatRate(node.metrics?.msgRate)}</span>
    </button>
  );
}

export function TopologyGraph({ snapshot, filters, selectedId, onSelect }: TopologyGraphProps) {
  const topology = useMemo(() => buildStructuredTopology(snapshot, filters), [filters, snapshot]);
  const relatedIds = useMemo(() => relatedApplicationIds(snapshot, selectedId), [selectedId, snapshot]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [links, setLinks] = useState<RenderedLink[]>([]);

  const setNodeRef = useCallback(
    (id: string) => (element: HTMLButtonElement | null) => {
      if (element) {
        refs.current.set(id, element);
      } else {
        refs.current.delete(id);
      }
    },
    []
  );

  useLayoutEffect(() => {
    const drawLinks = () => {
      const container = containerRef.current;
      if (!container) {
        setLinks([]);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const rendered = topology.links.flatMap((link) => {
        const source = refs.current.get(link.source);
        const target = refs.current.get(link.target);
        if (!source || !target) {
          return [];
        }
        const sourceRect = source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const x1 = sourceRect.left + sourceRect.width / 2 - containerRect.left;
        const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top + container.scrollTop;
        const x2 = targetRect.left + targetRect.width / 2 - containerRect.left;
        const y2 = targetRect.top + targetRect.height / 2 - containerRect.top + container.scrollTop;
        const mid = x1 + (x2 - x1) * 0.5;
        return [
          {
            ...link,
            width: Math.min(1.5 + Math.sqrt(link.msgRate) * 0.08, 7),
            selected: Boolean(selectedId && (link.source === selectedId || link.target === selectedId || relatedIds.has(link.source) || relatedIds.has(link.target))),
            path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
          }
        ];
      });
      setLinks(rendered);
    };

    drawLinks();
    const resizeObserver = new ResizeObserver(drawLinks);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
      containerRef.current.addEventListener("scroll", drawLinks, { passive: true });
    }
    window.addEventListener("resize", drawLinks);
    const timer = window.setTimeout(drawLinks, 100);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", drawLinks);
      window.clearTimeout(timer);
      containerRef.current?.removeEventListener("scroll", drawLinks);
    };
  }, [relatedIds, selectedId, topology]);

  const maxY = Math.max(
    640,
    ...links.flatMap((link) =>
      link.path
        .match(/[-0-9.]+/g)
        ?.map(Number)
        .filter((_, index) => index % 2 === 1) ?? []
    )
  );

  return (
    <section className="graph-shell" aria-label="Topology graph">
      <div className="structured-map" ref={containerRef}>
        <svg className="map-links" aria-hidden="true" height={maxY + 80}>
          {links.map((link) => (
            <path key={link.id} className={`map-link ${link.kind}${link.selected ? " selected" : ""}`} d={link.path} strokeWidth={link.selected ? link.width + 2 : link.width} />
          ))}
        </svg>

        <div className="map-column emitters">
          <div className="column-heading">
            <Send size={17} />
            <div>
              <span>Emitting Apps</span>
              <strong>{topology.emitters.length}</strong>
            </div>
          </div>
          {topology.emitters.map((node) => (
            <NodeCard key={node.id} node={node} tone="emitter" selected={selectedId === node.id} onSelect={onSelect} setNodeRef={setNodeRef} />
          ))}
        </div>

        <div className="map-column brokers">
          <div className="column-heading">
            <Database size={17} />
            <div>
              <span>Brokers</span>
              <strong>{topology.brokers.length}</strong>
            </div>
          </div>
          {topology.brokers.map((node) => (
            <NodeCard key={node.id} node={node} tone="broker" selected={selectedId === node.id} onSelect={onSelect} setNodeRef={setNodeRef} />
          ))}
        </div>

        <div className="map-column listeners">
          <div className="column-heading">
            <UsersRound size={17} />
            <div>
              <span>Listening Apps</span>
              <strong>{topology.listeners.length}</strong>
            </div>
          </div>
          {topology.listeners.map((node) => (
            <NodeCard key={node.id} node={node} tone="listener" selected={selectedId === node.id} onSelect={onSelect} setNodeRef={setNodeRef} />
          ))}
        </div>

        <div className="graph-count">
          <Activity size={15} />
          {topology.emitters.length} emitters / {topology.brokers.length} brokers / {topology.listeners.length} listeners
        </div>
      </div>
    </section>
  );
}
