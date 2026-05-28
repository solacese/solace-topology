import type { BrokerConfig, BrokersFile, CatalogFile } from "@solace-topology/shared";
import type { BrokerObservation, ClientObservation, QueueObservation, SubscriptionObservation } from "../collector/types.js";

function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) % 100_000;
  }
  return value;
}

function wave(seed: string, min: number, max: number, now = Date.now()): number {
  const phase = hash(seed) / 10_000;
  const normalized = (Math.sin(now / 12_000 + phase) + 1) / 2;
  return Math.round(min + normalized * (max - min));
}

function sampleClientName(appId: string, brokerId: string): string {
  return `${appId}-${brokerId}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

export function buildSampleObservations(brokersFile: BrokersFile, catalog: CatalogFile, brokerIds?: string[]): BrokerObservation[] {
  const selectedBrokerIds = new Set(brokerIds ?? brokersFile.brokers.map((broker) => broker.id));
  return brokersFile.brokers.filter((broker) => selectedBrokerIds.has(broker.id)).map((broker) => buildSampleBrokerObservation(broker, catalog));
}

function buildSampleBrokerObservation(broker: BrokerConfig, catalog: CatalogFile): BrokerObservation {
  const vpnName = broker.messageVpns[0] ?? "default";
  const clients: ClientObservation[] = [];
  const queues: QueueObservation[] = [];
  const subscriptions: SubscriptionObservation[] = [];

  for (const app of catalog.applications) {
    if (!app.brokerIds.includes(broker.id)) {
      continue;
    }

    const appBaseRate = app.role === "listener" ? wave(app.id, 80, 650) : wave(app.id, 120, 1_900);
    clients.push({
      brokerId: broker.id,
      vpnName,
      name: sampleClientName(app.id, broker.id),
      username: `${app.id}-svc`,
      connected: true,
      ingressMsgRate: app.role === "listener" ? 0 : appBaseRate,
      egressMsgRate: app.role === "emitter" ? 0 : Math.round(appBaseRate * 0.85),
      ingressByteRate: app.role === "listener" ? 0 : appBaseRate * wave(`${app.id}-bytes`, 380, 1_200),
      egressByteRate: app.role === "emitter" ? 0 : appBaseRate * wave(`${app.id}-bytes-egress`, 380, 1_200)
    });

    for (const queueName of app.listen?.queues ?? []) {
      const queueRate = wave(`${app.id}-${queueName}`, 80, 1_100);
      queues.push({
        brokerId: broker.id,
        vpnName,
        name: queueName,
        bindCount: wave(`${queueName}-binds`, 1, 4),
        queuedMessages: wave(`${queueName}-queued`, 0, 220),
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
      lastPollAt: new Date().toISOString(),
      latencyMs: 0
    }
  };
}
