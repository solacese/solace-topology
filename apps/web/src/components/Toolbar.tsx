import type { TopologySnapshot } from "@solace-topology/shared";
import { Search } from "lucide-react";
import { availableProvenances, type GraphFilters } from "../lib/graph.js";

interface ToolbarProps {
  snapshot: TopologySnapshot;
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
}

export function Toolbar({ snapshot, filters, onFiltersChange }: ToolbarProps) {
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
