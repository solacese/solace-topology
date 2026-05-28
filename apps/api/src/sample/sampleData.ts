import {
  matchesAnyPattern,
  type ApplicationCatalogEntry,
  type BrokerConfig,
  type BrokersFile,
  type CatalogFile
} from "@solace-topology/shared";
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

function roleCanPublish(app: ApplicationCatalogEntry): boolean {
  return app.role === "emitter" || app.role === "both";
}

function roleCanSubscribe(app: ApplicationCatalogEntry): boolean {
  return app.role === "listener" || app.role === "both";
}

function topicStem(pattern: string): string {
  const wildcardIndex = pattern.search(/[+>]/);
  return (wildcardIndex >= 0 ? pattern.slice(0, wildcardIndex) : pattern).replace(/\/$/, "");
}

function topicPatternsOverlap(left: string, right: string): boolean {
  if (left === right || left === ">" || right === ">") {
    return true;
  }
  return matchesAnyPattern(left, [right]) || matchesAnyPattern(right, [left]) || topicStem(left).startsWith(topicStem(right)) || topicStem(right).startsWith(topicStem(left));
}

function appsHaveTopicOverlap(publisher: ApplicationCatalogEntry, subscriber: ApplicationCatalogEntry): boolean {
  return (publisher.publishTopicPrefixes ?? []).some((publishedTopic) => (subscriber.listen?.topicPrefixes ?? []).some((subscribedTopic) => topicPatternsOverlap(publishedTopic, subscribedTopic)));
}

function buildSampleAppRates(catalog: CatalogFile, now: number): Map<string, number> {
  const rates = new Map<string, number>();
  const publisherRates = new Map<string, number>();

  for (const app of catalog.applications.filter(roleCanPublish)) {
    const msgRate = sampleValue(app.id, 120, 1_900, now);
    publisherRates.set(app.id, msgRate);
    rates.set(app.id, msgRate);
  }

  for (const subscriber of catalog.applications.filter(roleCanSubscribe)) {
    const subscriberMsgRate = catalog.applications
      .filter(roleCanPublish)
      .filter((publisher) => appsHaveTopicOverlap(publisher, subscriber))
      .reduce((sum, publisher) => sum + (publisherRates.get(publisher.id) ?? 0), 0);
    rates.set(subscriber.id, subscriberMsgRate + (publisherRates.get(subscriber.id) ?? 0));
  }

  return rates;
}

function valueFromMatcher(pattern: string | undefined, fallback: string): string {
  return (pattern ?? fallback).replace(/[*+>]+/g, "sample").replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function sampleClientName(app: ApplicationCatalogEntry, brokerId: string): string {
  return valueFromMatcher(app.clientMatchers?.[0], `${app.id}-${brokerId}`);
}

function sampleUsername(app: ApplicationCatalogEntry): string {
  return valueFromMatcher(app.usernameMatchers?.[0], `${app.id}-svc`);
}

export function buildSampleObservations(brokersFile: BrokersFile, catalog: CatalogFile, brokerIds?: string[]): BrokerObservation[] {
  const selectedBrokerIds = new Set(brokerIds ?? brokersFile.brokers.map((broker) => broker.id));
  const now = Date.now();
  const appRates = buildSampleAppRates(catalog, now);
  return brokersFile.brokers.filter((broker) => selectedBrokerIds.has(broker.id)).map((broker) => buildSampleBrokerObservation(broker, catalog, appRates, now));
}

function buildSampleBrokerObservation(broker: BrokerConfig, catalog: CatalogFile, appRates: Map<string, number>, now: number): BrokerObservation {
  const vpnName = broker.messageVpns[0] ?? "default";
  const clients: ClientObservation[] = [];
  const queues: QueueObservation[] = [];
  const subscriptions: SubscriptionObservation[] = [];

  for (const app of catalog.applications) {
    if (!app.brokerIds.includes(broker.id)) {
      continue;
    }

    const appBaseRate = appRates.get(app.id) ?? 0;
    clients.push({
      brokerId: broker.id,
      vpnName,
      name: sampleClientName(app, broker.id),
      username: sampleUsername(app),
      connected: true,
      ingressMsgRate: app.role === "listener" ? 0 : appBaseRate,
      egressMsgRate: app.role === "emitter" ? 0 : appBaseRate,
      ingressByteRate: app.role === "listener" ? 0 : appBaseRate * sampleValue(`${app.id}-bytes`, 380, 1_200, now),
      egressByteRate: app.role === "emitter" ? 0 : appBaseRate * sampleValue(`${app.id}-bytes-egress`, 380, 1_200, now)
    });

    for (const queueName of app.listen?.queues ?? []) {
      const queueRate = appBaseRate;
      queues.push({
        brokerId: broker.id,
        vpnName,
        name: queueName,
        bindCount: sampleValue(`${queueName}-binds`, 1, 4, now),
        queuedMessages: sampleValue(`${queueName}-queued`, 0, 220, now),
        ingressMsgRate: queueRate,
        egressMsgRate: queueRate,
        ingressByteRate: queueRate * 720,
        egressByteRate: queueRate * 720
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
