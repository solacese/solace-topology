import type { TopologySnapshot } from "@solace-topology/shared";
import { Search } from "lucide-react";
import type { SortMode } from "./TopologyGraph.js";
import { availableProvenances, type GraphFilters } from "../lib/graph.js";

interface ToolbarProps {
  snapshot: TopologySnapshot;
  filters: GraphFilters;
  sortMode: SortMode;
  onFiltersChange: (filters: GraphFilters) => void;
  onSortModeChange: (sortMode: SortMode) => void;
}

export function Toolbar({ snapshot, filters, sortMode, onFiltersChange, onSortModeChange }: ToolbarProps) {
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

      <label className="sort-control">
        <span>Sort</span>
        <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as SortMode)}>
          <option value="type">Type</option>
          <option value="name">Name</option>
          <option value="throughput">Throughput</option>
        </select>
      </label>

      <div className="control-group provenance-group" aria-label="Provenance filters">
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
    </section>
  );
}
