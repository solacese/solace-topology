import type { BrokerConfig, BrokersFile, CatalogFile } from "@solace-topology/shared";
import type { BrokerObservation, ClientObservation, QueueObservation, SubscriptionObservation } from "../collector/types.js";

function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) % 100_000;
  }
  return value;
}

function baselineValue(seed: string, min: number, max: number): number {
  return min + (hash(seed) % (max - min + 1));
}

function bucketRandom(seed: string, bucket: number): number {
  let value = (hash(seed) + bucket * 2_654_435_761) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4_294_967_295;
}

function sampleValue(seed: string, min: number, max: number, now: number): number {
  const baseline = baselineValue(seed, min, max);
  const bucket = Math.floor(now / 3_000);
  const normalized = bucketRandom(seed, bucket);
  const multiplier = 0.78 + normalized * 0.44;
  return Math.round(Math.min(max, Math.max(min, baseline * multiplier)));
}

function sampleClientName(appId: string, brokerId: string): string {
  return `${appId}-${brokerId}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

export function buildSampleObservations(brokersFile: BrokersFile, catalog: CatalogFile, brokerIds?: string[]): BrokerObservation[] {
  const selectedBrokerIds = new Set(brokerIds ?? brokersFile.brokers.map((broker) => broker.id));
  const now = Date.now();
  return brokersFile.brokers.filter((broker) => selectedBrokerIds.has(broker.id)).map((broker) => buildSampleBrokerObservation(broker, catalog, now));
}

function buildSampleBrokerObservation(broker: BrokerConfig, catalog: CatalogFile, now: number): BrokerObservation {
  const vpnName = broker.messageVpns[0] ?? "default";
  const clients: ClientObservation[] = [];
  const queues: QueueObservation[] = [];
  const subscriptions: SubscriptionObservation[] = [];

  for (const app of catalog.applications) {
    if (!app.brokerIds.includes(broker.id)) {
      continue;
    }

    const appBaseRate = app.role === "listener" ? sampleValue(app.id, 80, 650, now) : sampleValue(app.id, 120, 1_900, now);
    clients.push({
      brokerId: broker.id,
      vpnName,
      name: sampleClientName(app.id, broker.id),
      username: `${app.id}-svc`,
      connected: true,
      ingressMsgRate: app.role === "listener" ? 0 : appBaseRate,
      egressMsgRate: app.role === "emitter" ? 0 : Math.round(appBaseRate * 0.85),
      ingressByteRate: app.role === "listener" ? 0 : appBaseRate * sampleValue(`${app.id}-bytes`, 380, 1_200, now),
      egressByteRate: app.role === "emitter" ? 0 : appBaseRate * sampleValue(`${app.id}-bytes-egress`, 380, 1_200, now)
    });

    for (const queueName of app.listen?.queues ?? []) {
      const queueRate = sampleValue(`${app.id}-${queueName}`, 80, 1_100, now);
      queues.push({
        brokerId: broker.id,
        vpnName,
        name: queueName,
        bindCount: sampleValue(`${queueName}-binds`, 1, 4, now),
        queuedMessages: sampleValue(`${queueName}-queued`, 0, 220, now),
        ingressMsgRate: queueRate,
        egressMsgRate: Math.round(queueRate * 0.92),
        ingressByteRate: queueRate * 720,
        egressByteRate: Math.round(queueRate * 690)
      });
      for (const topic of app.listen?.topicPrefixes ?? []) {
        subscriptions.push({
          brokerId: broker.id,
          vpnName,
          queueName,
          topic
        });
      }
    }
  }

  return {
    brokerId: broker.id,
    mode: "sample",
    clients,
    queues,
    subscriptions,
    status: {
      brokerId: broker.id,
      displayName: broker.displayName,
      status: "sample",
      mode: "sample",
      lastPollAt: new Date(now).toISOString(),
      latencyMs: 0
    }
  };
}
