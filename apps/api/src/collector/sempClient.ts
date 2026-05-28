import { Agent, fetch } from "undici";
import type { BrokerConfig } from "@solace-topology/shared";
import type { BrokerObservation, ClientObservation, QueueObservation, SubscriptionObservation } from "./types.js";

interface SempResponse<T> {
  data?: T[];
  meta?: {
    paging?: {
      cursorQuery?: string;
    };
  };
}

function encodeResource(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, "%2F");
}

function numberFrom(record: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

function stringFrom(record: Record<string, unknown>, names: string[], fallback = ""): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return fallback;
}

function boolFrom(record: Record<string, unknown>, names: string[], fallback = true): boolean {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return ["true", "up", "connected", "enabled"].includes(value.toLowerCase());
    }
  }
  return fallback;
}

export class SempClient {
  async collectBroker(broker: BrokerConfig): Promise<BrokerObservation> {
    const start = Date.now();
    const clients: ClientObservation[] = [];
    const queues: QueueObservation[] = [];
    const subscriptions: SubscriptionObservation[] = [];

    for (const vpnName of broker.messageVpns) {
      const rawClients = await this.fetchCollection<Record<string, unknown>>(broker, "monitor", `msgVpns/${encodeResource(vpnName)}/clients?count=100`);
      clients.push(...rawClients.map((raw) => this.normalizeClient(broker.id, vpnName, raw)));

      const rawQueues = await this.fetchCollection<Record<string, unknown>>(broker, "monitor", `msgVpns/${encodeResource(vpnName)}/queues?count=100`);
      const normalizedQueues = rawQueues.map((raw) => this.normalizeQueue(broker.id, vpnName, raw));
      queues.push(...normalizedQueues);

      for (const queue of normalizedQueues) {
        const rawSubscriptions = await this.fetchCollection<Record<string, unknown>>(
          broker,
          "config",
          `msgVpns/${encodeResource(vpnName)}/queues/${encodeResource(queue.name)}/subscriptions?count=100`
        );
        subscriptions.push(...rawSubscriptions.map((raw) => this.normalizeSubscription(broker.id, vpnName, queue.name, raw)));
      }
    }

    return {
      brokerId: broker.id,
      mode: "live",
      clients,
      queues,
      subscriptions,
      status: {
        brokerId: broker.id,
        displayName: broker.displayName,
        status: "connected",
        mode: "live",
        lastPollAt: new Date().toISOString(),
        latencyMs: Date.now() - start
      }
    };
  }

  private async fetchCollection<T extends Record<string, unknown>>(broker: BrokerConfig, api: "monitor" | "config", resource: string): Promise<T[]> {
    const authHeader = this.authHeaderForBroker(broker);

    const baseUrl = broker.managementUrl.replace(/\/$/, "");
    let nextUrl = `${baseUrl}/SEMP/v2/${api}/${resource}`;
    const seen = new Set<string>();
    const records: T[] = [];
    const dispatcher = broker.managementUrl.startsWith("https:")
      ? new Agent({ connect: { rejectUnauthorized: broker.tlsRejectUnauthorized } })
      : undefined;

    while (nextUrl) {
      if (seen.has(nextUrl)) {
        throw new Error(`SEMP pagination loop detected for ${broker.id}: ${nextUrl}`);
      }
      seen.add(nextUrl);

      const response = await fetch(nextUrl, {
        dispatcher,
        headers: {
          authorization: authHeader,
          accept: "application/json"
        },
        signal: AbortSignal.timeout(8_000)
      });

      if (!response.ok) {
        throw new Error(`SEMP ${api} request failed for ${broker.id}: ${response.status} ${response.statusText}`);
      }

      const body = (await response.json()) as SempResponse<T>;
      records.push(...(body.data ?? []));
      const cursorQuery = body.meta?.paging?.cursorQuery;
      nextUrl = cursorQuery ? this.resolveCursorUrl(baseUrl, api, resource, cursorQuery) : "";
    }

    return records;
  }

  private authHeaderForBroker(broker: BrokerConfig): string {
    if (broker.authMode === "bearer") {
      const token = broker.sempApiKey ?? (broker.sempApiKeyEnv ? process.env[broker.sempApiKeyEnv] : undefined);
      if (!token) {
        throw new Error(`Missing SEMP API key for ${broker.id}; set sempApiKey or ${broker.sempApiKeyEnv ?? "sempApiKeyEnv"}`);
      }
      return `Bearer ${token}`;
    }

    const username = broker.username ?? (broker.usernameEnv ? process.env[broker.usernameEnv] : undefined);
    const password = broker.password ?? (broker.passwordEnv ? process.env[broker.passwordEnv] : undefined);
    if (!username || !password) {
      throw new Error(`Missing basic auth credentials for ${broker.id}; set username/password or ${broker.usernameEnv ?? "usernameEnv"}/${broker.passwordEnv ?? "passwordEnv"}`);
    }
    return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  private resolveCursorUrl(baseUrl: string, api: "monitor" | "config", resource: string, cursorQuery: string): string {
    if (cursorQuery.startsWith("http://") || cursorQuery.startsWith("https://")) {
      return cursorQuery;
    }
    if (cursorQuery.startsWith("/SEMP/")) {
      return `${baseUrl}${cursorQuery}`;
    }
    if (cursorQuery.startsWith("?")) {
      return `${baseUrl}/SEMP/v2/${api}/${resource.split("?")[0]}${cursorQuery}`;
    }
    return `${baseUrl}/SEMP/v2/${api}/${cursorQuery.replace(/^\//, "")}`;
  }

  private normalizeClient(brokerId: string, vpnName: string, raw: Record<string, unknown>): ClientObservation {
    return {
      brokerId,
      vpnName,
      name: stringFrom(raw, ["clientName", "name"], "unknown-client"),
      username: stringFrom(raw, ["username", "userName"], undefined),
      connected: boolFrom(raw, ["isConnected", "connected", "enabled"], true),
      ingressMsgRate: numberFrom(raw, ["clientDataMessagesReceivedRate", "dataMessagesReceivedRate", "rxMsgRate", "ingressMsgRate"]),
      egressMsgRate: numberFrom(raw, ["clientDataMessagesSentRate", "dataMessagesSentRate", "txMsgRate", "egressMsgRate"]),
      ingressByteRate: numberFrom(raw, ["clientDataBytesReceivedRate", "dataBytesReceivedRate", "rxByteRate", "ingressByteRate"]),
      egressByteRate: numberFrom(raw, ["clientDataBytesSentRate", "dataBytesSentRate", "txByteRate", "egressByteRate"])
    };
  }

  private normalizeQueue(brokerId: string, vpnName: string, raw: Record<string, unknown>): QueueObservation {
    return {
      brokerId,
      vpnName,
      name: stringFrom(raw, ["queueName", "name"], "unknown-queue"),
      bindCount: numberFrom(raw, ["bindCount", "consumerCount", "numBoundClients"]),
      queuedMessages: numberFrom(raw, ["currentMessagesSpooled", "spooledMsgCount", "queuedMessages"]),
      ingressMsgRate: numberFrom(raw, ["msgSpoolUsageIngressRate", "dataMessagesReceivedRate", "ingressMsgRate"]),
      egressMsgRate: numberFrom(raw, ["msgSpoolUsageEgressRate", "dataMessagesSentRate", "egressMsgRate"]),
      ingressByteRate: numberFrom(raw, ["byteSpoolUsageIngressRate", "dataBytesReceivedRate", "ingressByteRate"]),
      egressByteRate: numberFrom(raw, ["byteSpoolUsageEgressRate", "dataBytesSentRate", "egressByteRate"])
    };
  }

  private normalizeSubscription(brokerId: string, vpnName: string, queueName: string, raw: Record<string, unknown>): SubscriptionObservation {
    return {
      brokerId,
      vpnName,
      queueName,
      topic: stringFrom(raw, ["subscriptionTopic", "topic", "topicSubscription"], ">")
    };
  }
}
