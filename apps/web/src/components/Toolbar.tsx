import type { TopologySnapshot } from "@solace-topology/shared";
import { Pause, Play, Search, ShieldCheck } from "lucide-react";
import { availableProvenances, type GraphFilters } from "../lib/graph.js";

interface ToolbarProps {
  snapshot: TopologySnapshot;
  filters: GraphFilters;
  paused: boolean;
  onFiltersChange: (filters: GraphFilters) => void;
  onPausedChange: (paused: boolean) => void;
}

export function Toolbar({ snapshot, filters, paused, onFiltersChange, onPausedChange }: ToolbarProps) {
  const provenances = availableProvenances(snapshot);

  function toggleProvenance(provenance: string) {
    const next = new Set(filters.provenances);
    if (next.has(provenance)) {
      next.delete(provenance);
    } else {
      next.add(provenance);
    }
    onFiltersChange({ ...filters, provenances: next });
  }

  return (
    <section className="toolbar" aria-label="Topology controls">
      <div className="search-box">
        <Search size={18} />
        <input
          aria-label="Search topology"
          value={filters.search}
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          placeholder="Search apps, topics, brokers"
        />
      </div>

      <div className="control-group provenance-group" aria-label="Provenance filters">
        <ShieldCheck size={16} />
        {provenances.map((provenance) => (
          <button
            key={provenance}
            className={filters.provenances.has(provenance) ? "chip active" : "chip"}
            onClick={() => toggleProvenance(provenance)}
          >
            {provenance}
          </button>
        ))}
      </div>

      <button className="live-toggle" onClick={() => onPausedChange(!paused)}>
        {paused ? <Play size={18} /> : <Pause size={18} />}
        {paused ? "Resume" : "Live"}
      </button>
    </section>
  );
}
