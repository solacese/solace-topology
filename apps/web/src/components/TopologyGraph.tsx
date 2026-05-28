import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Database, RadioTower, Send, UsersRound } from "lucide-react";
import { formatRate, type TopologyNode, type TopologySnapshot } from "@solace-topology/shared";
import { activeRouteNodeIds, brokerRouteOffsets, buildStructuredTopology, relatedBrokerIds, type GraphFilters, type StructuredLink, type StructuredTopology } from "../lib/graph.js";

interface TopologyGraphProps {
  snapshot: TopologySnapshot;
  filters: GraphFilters;
  sortMode: SortMode;
  selectedId?: string;
  onSelect: (item: TopologyNode | undefined) => void;
}

interface RenderedLink extends StructuredLink {
  path: string;
  width: number;
  selected: boolean;
  dimmed: boolean;
}

export type SortMode = "type" | "name" | "throughput";

function roleLabel(role: string | undefined): string {
  if (role === "emitter") {
    return "Publisher";
  }
  if (role === "listener") {
    return "Subscriber";
  }
  if (role === "both") {
    return "Publisher / Subscriber";
  }
  return "Application";
}

function brokerKind(node: TopologyNode): "edge" | "cloud" | "core" {
  const tags = Array.isArray(node.metadata?.tags) ? node.metadata.tags.map(String) : [];
  const text = `${tags.join(" ")} ${node.metadata?.site ?? ""} ${node.metadata?.physicalLocation ?? ""}`.toLowerCase();
  if (text.includes("cloud")) {
    return "cloud";
  }
  if (text.includes("edge") || text.includes("plant") || text.includes("field") || text.includes("store") || text.includes("branch")) {
    return "edge";
  }
  return "core";
}

function brokerKindLabel(kind: "edge" | "cloud" | "core"): string {
  if (kind === "cloud") {
    return "Cloud broker";
  }
  if (kind === "edge") {
    return "Edge broker";
  }
  return "Core broker";
}

function typeSortValue(node: TopologyNode): string {
  if (node.type === "Broker") {
    const rank = { edge: "0", core: "1", cloud: "2" }[brokerKind(node)];
    return `${rank}:${brokerKind(node)}`;
  }
  return String(node.metadata?.provenance ?? node.metadata?.role ?? "");
}

function compareNodes(left: TopologyNode, right: TopologyNode, sortMode: SortMode): number {
  if (sortMode === "throughput") {
    const rate = (right.metrics?.msgRate ?? 0) - (left.metrics?.msgRate ?? 0);
    if (rate !== 0) {
      return rate;
    }
  }
  if (sortMode === "type") {
    const type = typeSortValue(left).localeCompare(typeSortValue(right));
    if (type !== 0) {
      return type;
    }
  }
  return left.label.localeCompare(right.label);
}

function orderActiveNodes(nodes: TopologyNode[], activeIds: Set<string>, selectedId: string | undefined, sortMode: SortMode): TopologyNode[] {
  return [...nodes].sort((left, right) => {
    const leftSelected = left.id === selectedId ? 0 : 1;
    const rightSelected = right.id === selectedId ? 0 : 1;
    if (leftSelected !== rightSelected) {
      return leftSelected - rightSelected;
    }
    const leftActive = activeIds.has(left.id) ? 0 : 1;
    const rightActive = activeIds.has(right.id) ? 0 : 1;
    if (leftActive !== rightActive) {
      return leftActive - rightActive;
    }
    return compareNodes(left, right, sortMode);
  });
}

function orderTopology(topology: StructuredTopology, activeIds: Set<string>, selectedId: string | undefined, sortMode: SortMode): StructuredTopology {
  return {
    ...topology,
    emitters: orderActiveNodes(topology.emitters, activeIds, selectedId, sortMode),
    brokers: orderActiveNodes(topology.brokers, activeIds, selectedId, sortMode),
    listeners: orderActiveNodes(topology.listeners, activeIds, selectedId, sortMode)
  };
}

function NodeCard({
  node,
  tone,
  selected,
  dimmed,
  routeOffset,
  onSelect,
  setNodeRef
}: {
  node: TopologyNode;
  tone: "emitter" | "broker" | "listener";
  selected: boolean;
  dimmed: boolean;
  routeOffset: number;
  onSelect: (node: TopologyNode | undefined) => void;
  setNodeRef: (id: string) => (element: HTMLButtonElement | null) => void;
}) {
  const Icon = tone === "emitter" ? Send : tone === "listener" ? UsersRound : RadioTower;
  const provenance = String(node.metadata?.provenance ?? "");
  const location = tone === "broker" ? String(node.metadata?.physicalLocation ?? node.metadata?.site ?? "") : "";
  const kind = tone === "broker" ? brokerKind(node) : "";
  const style = routeOffset ? ({ "--route-offset": `${routeOffset}px` } as CSSProperties) : undefined;
  return (
    <button
      ref={setNodeRef(node.id)}
      className={`topology-node ${tone}${kind ? ` ${kind}` : ""}${selected ? " selected" : ""}${dimmed ? " dimmed" : ""}${routeOffset ? " route-offset" : ""}`}
      style={style}
      onClick={() => onSelect(selected ? undefined : node)}
    >
      <span className="node-icon">
        <Icon size={17} />
      </span>
      <span className="node-content">
        <strong>{node.label}</strong>
        <span>
          {location ? `${brokerKindLabel(kind as "edge" | "cloud" | "core")} / ${location}` : `${roleLabel(String(node.metadata?.role ?? ""))}${provenance ? ` / ${provenance}` : ""}`}
        </span>
      </span>
      <span className="node-rate">{formatRate(node.metrics?.msgRate)}</span>
    </button>
  );
}

export function TopologyGraph({ snapshot, filters, sortMode, selectedId, onSelect }: TopologyGraphProps) {
  const topology = useMemo(() => buildStructuredTopology(snapshot, filters), [filters, snapshot]);
  const relatedBrokers = useMemo(() => relatedBrokerIds(snapshot, selectedId), [selectedId, snapshot]);
  const activeIds = useMemo(() => activeRouteNodeIds(snapshot, selectedId), [selectedId, snapshot]);
  const routeOffsets = useMemo(() => brokerRouteOffsets(snapshot, selectedId), [selectedId, snapshot]);
  const orderedTopology = useMemo(() => orderTopology(topology, activeIds, selectedId, sortMode), [activeIds, selectedId, sortMode, topology]);
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
      const rendered = orderedTopology.links.flatMap((link) => {
        const source = refs.current.get(link.source);
        const target = refs.current.get(link.target);
        if (!source || !target) {
          return [];
        }
        const sourceRect = source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const sourceCenterX = sourceRect.left + sourceRect.width / 2;
        const sourceCenterY = sourceRect.top + sourceRect.height / 2;
        const targetCenterX = targetRect.left + targetRect.width / 2;
        const targetCenterY = targetRect.top + targetRect.height / 2;
        const horizontalRoute = Math.abs(targetCenterX - sourceCenterX) >= Math.abs(targetCenterY - sourceCenterY);
        const x1 = (horizontalRoute ? (targetCenterX >= sourceCenterX ? sourceRect.right : sourceRect.left) : sourceCenterX) - containerRect.left;
        const y1 = (horizontalRoute ? sourceCenterY : targetCenterY >= sourceCenterY ? sourceRect.bottom : sourceRect.top) - containerRect.top + container.scrollTop;
        const x2 = (horizontalRoute ? (targetCenterX >= sourceCenterX ? targetRect.left : targetRect.right) : targetCenterX) - containerRect.left;
        const y2 = (horizontalRoute ? targetCenterY : targetCenterY >= sourceCenterY ? targetRect.top : targetRect.bottom) - containerRect.top + container.scrollTop;
        const mid = x1 + (x2 - x1) * 0.5;
        const activeLink = Boolean(
          selectedId &&
            activeIds.has(link.source) &&
            activeIds.has(link.target) &&
            (link.kind !== "mesh" || (relatedBrokers.has(link.source.replace(/^broker:/, "")) && relatedBrokers.has(link.target.replace(/^broker:/, ""))))
        );
        return [
          {
            ...link,
            width: link.kind === "mesh" ? 2.2 : Math.min(1.5 + Math.sqrt(link.msgRate) * 0.08, 7),
            selected: activeLink,
            dimmed: Boolean(selectedId && !activeLink),
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
  }, [activeIds, orderedTopology, relatedBrokers, selectedId]);

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
      <div
        className="structured-map"
        ref={containerRef}
        onClick={(event) => {
          const target = event.target instanceof Element ? event.target : undefined;
          if (target && !target.closest(".topology-node, .column-heading")) {
            onSelect(undefined);
          }
        }}
      >
        <svg className="map-links" aria-hidden="true" height={maxY + 80}>
          {links.map((link) => (
            <path key={link.id} className={`map-link ${link.kind}${link.selected ? " selected" : ""}${link.dimmed ? " dimmed" : ""}`} d={link.path} strokeWidth={link.selected ? link.width + 2 : link.width} />
          ))}
        </svg>

        <div className="map-column emitters">
          <div className="column-heading">
            <Send size={17} />
            <div>
              <span>Publishers</span>
              <strong>{orderedTopology.emitters.length}</strong>
            </div>
          </div>
          {orderedTopology.emitters.map((node) => (
            <NodeCard key={node.id} node={node} tone="emitter" selected={selectedId === node.id} dimmed={Boolean(selectedId && !activeIds.has(node.id))} routeOffset={0} onSelect={onSelect} setNodeRef={setNodeRef} />
          ))}
        </div>

        <div className="map-column brokers">
          <div className="column-heading">
            <Database size={17} />
            <div>
              <span>Brokers</span>
              <strong>{orderedTopology.brokers.length}</strong>
            </div>
          </div>
          {orderedTopology.brokers.map((node) => (
            <NodeCard key={node.id} node={node} tone="broker" selected={selectedId === node.id} dimmed={Boolean(selectedId && !activeIds.has(node.id))} routeOffset={routeOffsets.get(node.id) ?? 0} onSelect={onSelect} setNodeRef={setNodeRef} />
          ))}
        </div>

        <div className="map-column listeners">
          <div className="column-heading">
            <UsersRound size={17} />
            <div>
              <span>Subscribers</span>
              <strong>{orderedTopology.listeners.length}</strong>
            </div>
          </div>
          {orderedTopology.listeners.map((node) => (
            <NodeCard key={node.id} node={node} tone="listener" selected={selectedId === node.id} dimmed={Boolean(selectedId && !activeIds.has(node.id))} routeOffset={0} onSelect={onSelect} setNodeRef={setNodeRef} />
          ))}
        </div>

      </div>
    </section>
  );
}
