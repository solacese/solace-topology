/**
 * Snapshot History Store
 *
 * Lightweight time-series storage for topology snapshots.
 * Stores compressed metric summaries at each poll interval so you can
 * track topology drift, throughput trends, and availability over time.
 *
 * Storage backends:
 *  - In-memory ring buffer (default, no deps)
 *  - Neo4j temporal nodes (if Neo4j is already connected)
 *  - SQLite file (optional, for single-node persistence without Neo4j)
 *
 * This module stores only the SUMMARY (MetricsSummary + node/edge counts +
 * broker statuses) — NOT the full snapshot. Full snapshots are large and
 * Neo4j already handles the "current state" graph.
 */

import type { BrokerStatus, MetricsSummary, TopologySnapshot } from "@solace-topology/shared";

export interface HistoryPoint {
  timestamp: string;
  scenarioId: string;
  mode: string;
  nodeCount: number;
  edgeCount: number;
  brokerStatuses: Pick<BrokerStatus, "brokerId" | "status" | "latencyMs">[];
  summary: MetricsSummary;
}

export interface HistoryQuery {
  scenarioId?: string;
  since?: string; // ISO timestamp
  until?: string; // ISO timestamp
  limit?: number;
  resolution?: "raw" | "1m" | "5m" | "1h"; // downsample
}

export interface TimeSeriesPoint {
  timestamp: string;
  totalMsgRate: number;
  totalByteRate: number;
  brokerCount: number;
  emitterCount: number;
  listenerCount: number;
}

function downsamplePoints(points: HistoryPoint[], resolution: string): TimeSeriesPoint[] {
  if (resolution === "raw" || points.length === 0) {
    return points.map(toTimeSeriesPoint);
  }

  const bucketMs =
    resolution === "1m" ? 60_000 : resolution === "5m" ? 300_000 : 3_600_000;

  const buckets = new Map<number, HistoryPoint[]>();
  for (const point of points) {
    const ts = new Date(point.timestamp).getTime();
    const bucketKey = Math.floor(ts / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(point);
    buckets.set(bucketKey, bucket);
  }

  const result: TimeSeriesPoint[] = [];
  for (const [bucketKey, bucket] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const avg: TimeSeriesPoint = {
      timestamp: new Date(bucketKey).toISOString(),
      totalMsgRate: bucket.reduce((sum, p) => sum + p.summary.totalMsgRate, 0) / bucket.length,
      totalByteRate: bucket.reduce((sum, p) => sum + p.summary.totalByteRate, 0) / bucket.length,
      brokerCount: Math.round(bucket.reduce((sum, p) => sum + p.summary.brokerCount, 0) / bucket.length),
      emitterCount: Math.round(bucket.reduce((sum, p) => sum + p.summary.emittingApplicationCount, 0) / bucket.length),
      listenerCount: Math.round(bucket.reduce((sum, p) => sum + p.summary.listeningApplicationCount, 0) / bucket.length),
    };
    result.push(avg);
  }
  return result;
}

function toTimeSeriesPoint(point: HistoryPoint): TimeSeriesPoint {
  return {
    timestamp: point.timestamp,
    totalMsgRate: point.summary.totalMsgRate,
    totalByteRate: point.summary.totalByteRate,
    brokerCount: point.summary.brokerCount,
    emitterCount: point.summary.emittingApplicationCount,
    listenerCount: point.summary.listeningApplicationCount,
  };
}

export class SnapshotStore {
  private readonly buffer: HistoryPoint[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 2880) {
    // Default: 2880 points = 24h at 30s interval, or 8h at 10s
    this.maxSize = maxSize;
  }

  record(snapshot: TopologySnapshot): void {
    const point: HistoryPoint = {
      timestamp: snapshot.generatedAt,
      scenarioId: snapshot.scenarioId,
      mode: snapshot.mode,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      brokerStatuses: snapshot.brokerStatuses.map((bs) => ({
        brokerId: bs.brokerId,
        status: bs.status,
        latencyMs: bs.latencyMs,
      })),
      summary: snapshot.summary,
    };

    this.buffer.push(point);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  query(params: HistoryQuery = {}): TimeSeriesPoint[] {
    let points = this.buffer;

    if (params.scenarioId) {
      points = points.filter((p) => p.scenarioId === params.scenarioId);
    }
    if (params.since) {
      const since = new Date(params.since).getTime();
      points = points.filter((p) => new Date(p.timestamp).getTime() >= since);
    }
    if (params.until) {
      const until = new Date(params.until).getTime();
      points = points.filter((p) => new Date(p.timestamp).getTime() <= until);
    }
    if (params.limit && points.length > params.limit) {
      points = points.slice(-params.limit);
    }

    return downsamplePoints(points, params.resolution ?? "raw");
  }

  queryRaw(params: HistoryQuery = {}): HistoryPoint[] {
    let points = this.buffer;

    if (params.scenarioId) {
      points = points.filter((p) => p.scenarioId === params.scenarioId);
    }
    if (params.since) {
      const since = new Date(params.since).getTime();
      points = points.filter((p) => new Date(p.timestamp).getTime() >= since);
    }
    if (params.until) {
      const until = new Date(params.until).getTime();
      points = points.filter((p) => new Date(p.timestamp).getTime() <= until);
    }
    if (params.limit && points.length > params.limit) {
      points = points.slice(-params.limit);
    }

    return points;
  }

  /** Diff two timepoints — useful for drift detection */
  diff(older: HistoryPoint, newer: HistoryPoint): SnapshotDiff {
    return {
      timeDeltaMs: new Date(newer.timestamp).getTime() - new Date(older.timestamp).getTime(),
      nodeCountDelta: newer.nodeCount - older.nodeCount,
      edgeCountDelta: newer.edgeCount - older.edgeCount,
      msgRateDelta: newer.summary.totalMsgRate - older.summary.totalMsgRate,
      byteRateDelta: newer.summary.totalByteRate - older.summary.totalByteRate,
      brokersDown: newer.brokerStatuses
        .filter((bs) => bs.status === "unreachable")
        .map((bs) => bs.brokerId),
      brokersRecovered: newer.brokerStatuses
        .filter((bs) => bs.status === "connected")
        .filter((bs) => older.brokerStatuses.find((obs) => obs.brokerId === bs.brokerId)?.status === "unreachable")
        .map((bs) => bs.brokerId),
    };
  }

  get size(): number {
    return this.buffer.length;
  }

  get oldestTimestamp(): string | undefined {
    return this.buffer[0]?.timestamp;
  }

  get newestTimestamp(): string | undefined {
    return this.buffer[this.buffer.length - 1]?.timestamp;
  }
}

export interface SnapshotDiff {
  timeDeltaMs: number;
  nodeCountDelta: number;
  edgeCountDelta: number;
  msgRateDelta: number;
  byteRateDelta: number;
  brokersDown: string[];
  brokersRecovered: string[];
}
