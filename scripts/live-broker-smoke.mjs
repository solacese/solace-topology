import path from "node:path";
import { fileURLToPath } from "node:url";
import rhea from "rhea";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const brokers = [
  { id: "local-broker-1", sempUrl: process.env.LIVE_BROKER_1_URL ?? "http://localhost:19080", amqpUrl: process.env.LIVE_BROKER_1_AMQP_URL ?? "amqp://localhost:15672", topic: "live/b1/metric", queueSubscription: "live/b1/>", publisher: "pub-b1", subscriber: "sub-b1", queue: "Q.LIVE.B1" },
  { id: "local-broker-2", sempUrl: process.env.LIVE_BROKER_2_URL ?? "http://localhost:29080", amqpUrl: process.env.LIVE_BROKER_2_AMQP_URL ?? "amqp://localhost:25672", topic: "live/b2/metric", queueSubscription: "live/b2/>", publisher: "pub-b2", subscriber: "sub-b2", queue: "Q.LIVE.B2" },
  { id: "local-broker-3", sempUrl: process.env.LIVE_BROKER_3_URL ?? "http://localhost:39080", amqpUrl: process.env.LIVE_BROKER_3_AMQP_URL ?? "amqp://localhost:35672", topic: "live/b3/metric", queueSubscription: "live/b3/>", publisher: "pub-b3", subscriber: "sub-b3", queue: "Q.LIVE.B3" },
  { id: "local-broker-4", sempUrl: process.env.LIVE_BROKER_4_URL ?? "http://localhost:49080", amqpUrl: process.env.LIVE_BROKER_4_AMQP_URL ?? "amqp://localhost:45672", topic: "live/b4/metric", queueSubscription: "live/b4/>", publisher: "pub-b4", subscriber: "sub-b4", queue: "Q.LIVE.B4" },
  { id: "local-broker-5", sempUrl: process.env.LIVE_BROKER_5_URL ?? "http://localhost:59080", amqpUrl: process.env.LIVE_BROKER_5_AMQP_URL ?? "amqp://localhost:55672", topic: "live/b5/metric", queueSubscription: "live/b5/>", publisher: "pub-b5", subscriber: "sub-b5", queue: "Q.LIVE.B5" }
];

const trafficOnly = process.argv.includes("--traffic-only");

const sempUser = process.env.SEMP_USER_LIVE ?? "admin";
const sempPassword = process.env.SEMP_PASSWORD_LIVE ?? "admin";
const clientPassword = process.env.LIVE_CLIENT_PASSWORD ?? "secret";
const amqpAuthMode = process.env.LIVE_AMQP_AUTH_MODE ?? "anonymous";

process.env.SEMP_USER_LIVE = sempUser;
process.env.SEMP_PASSWORD_LIVE = sempPassword;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeader() {
  return `Basic ${Buffer.from(`${sempUser}:${sempPassword}`).toString("base64")}`;
}

function encodeResource(value) {
  return encodeURIComponent(value).replace(/%2F/g, "%2F");
}

async function sempRequest(broker, method, resource, body) {
  const response = await fetch(`${broker.sempUrl}/SEMP/v2/${resource}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: authHeader(),
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = payload?.meta?.error?.description ?? payload?.meta?.error?.status ?? response.statusText;
    throw new Error(`${method} ${resource} failed for ${broker.id}: ${response.status} ${message}`);
  }
  return payload;
}

async function exists(broker, resource) {
  try {
    await sempRequest(broker, "GET", resource);
    return true;
  } catch (error) {
    const message = String(error.message);
    if (message.includes(": 404 ") || message.includes("Could not find match")) {
      return false;
    }
    throw error;
  }
}

async function waitForBroker(broker) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    try {
      await sempRequest(broker, "GET", "monitor/about/api");
      return;
    } catch {
      await sleep(2_000);
    }
  }
  throw new Error(`${broker.id} did not become ready at ${broker.sempUrl}`);
}

async function ensureClientUsername(broker, username) {
  const resource = `config/msgVpns/default/clientUsernames/${encodeResource(username)}`;
  const body = {
    clientUsername: username,
    password: clientPassword,
    enabled: true,
    clientProfileName: "default",
    aclProfileName: "default"
  };
  if (await exists(broker, resource)) {
    await sempRequest(broker, "PATCH", resource, body);
    return;
  }
  await sempRequest(broker, "POST", "config/msgVpns/default/clientUsernames", body);
}

async function ensureQueue(broker) {
  const resource = `config/msgVpns/default/queues/${encodeResource(broker.queue)}`;
  const body = {
    queueName: broker.queue,
    ingressEnabled: true,
    egressEnabled: true,
    permission: "consume",
    accessType: "exclusive",
    maxMsgSpoolUsage: 100
  };
  if (await exists(broker, resource)) {
    await sempRequest(broker, "PATCH", resource, body);
  } else {
    await sempRequest(broker, "POST", "config/msgVpns/default/queues", body);
  }

  const subscriptionResource = `${resource}/subscriptions/${encodeResource(broker.queueSubscription)}`;
  if (!(await exists(broker, subscriptionResource))) {
    await sempRequest(broker, "POST", `${resource}/subscriptions`, { subscriptionTopic: broker.queueSubscription });
  }
}

async function retryWhileSpoolStarts(broker, action) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (!String(error.message).includes("message spool data not available") || attempt === 60) {
        throw error;
      }
      await sleep(2_000);
    }
  }
}

async function configureBroker(broker) {
  await ensureClientUsername(broker, broker.publisher);
  await ensureClientUsername(broker, broker.subscriber);
  await retryWhileSpoolStarts(broker, () => ensureQueue(broker));
}

function amqpOptions(broker, username, suffix) {
  const url = new URL(broker.amqpUrl);
  const protocol = url.protocol.replace(":", "");
  const vpnName = "default";
  return {
    host: url.hostname,
    port: Number(url.port || (protocol === "amqps" ? 5671 : 5672)),
    transport: protocol === "amqps" ? "tls" : "tcp",
    ...(amqpAuthMode === "basic" ? { username, password: clientPassword } : {}),
    reconnect: false,
    id: `${username}-${suffix}`,
    container_id: `${username}-${suffix}`,
    hostname: vpnName,
    sasl_init_hostname: vpnName
  };
}

function errorFromAmqpContext(context, fallback) {
  const error = context?.error ?? context?.connection?.error ?? context;
  if (error instanceof Error) {
    return error;
  }
  if (error?.description) {
    return new Error(error.description);
  }
  if (error?.condition) {
    return new Error(String(error.condition));
  }
  return new Error(fallback);
}

function waitForAmqpConnection(container, broker, username, suffix) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`AMQP connection timed out for ${broker.id} as ${username}`)), 20_000);
    let settled = false;
    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        callback(value);
      }
    };
    container.once("connection_open", (context) => finish(resolve, context.connection));
    container.once("error", (context) => finish(reject, errorFromAmqpContext(context, `AMQP error for ${broker.id} as ${username}`)));
    container.once("connection_error", (context) => finish(reject, errorFromAmqpContext(context, `AMQP connection failed for ${broker.id} as ${username}`)));
    container.once("protocol_error", (context) => finish(reject, errorFromAmqpContext(context, `AMQP protocol error for ${broker.id} as ${username}`)));
    container.once("disconnected", (context) => finish(reject, errorFromAmqpContext(context, `AMQP disconnected before open for ${broker.id} as ${username}`)));
    container.connect(amqpOptions(broker, username, suffix));
  });
}

async function openAmqpSubscriber(broker, suffix) {
  const container = rhea.create_container({ id: `${broker.subscriber}-${suffix}` });
  const connection = await waitForAmqpConnection(container, broker, broker.subscriber, suffix);
  let received = 0;
  let receiver;

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`AMQP receiver timed out for ${broker.id}`)), 20_000);
    let settled = false;
    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        callback(value);
      }
    };
    container.on("message", () => {
      received += 1;
    });
    container.once("receiver_open", () => finish(resolve));
    container.once("receiver_error", (context) => finish(reject, errorFromAmqpContext(context, `AMQP receiver failed for ${broker.id}`)));
    receiver = connection.open_receiver({
      name: `${broker.subscriber}-${suffix}`,
      source: {
        address: `queue://${broker.queue}`,
        durable: 1,
        expiry_policy: "never"
      },
      autoaccept: true
    });
  });
  await ready;

  return {
    get received() {
      return received;
    },
    close() {
      receiver?.close();
      connection.close();
    }
  };
}

async function openAmqpPublisher(broker, suffix) {
  const container = rhea.create_container({ id: `${broker.publisher}-${suffix}` });
  const connection = await waitForAmqpConnection(container, broker, broker.publisher, suffix);
  let sender;
  let timer;

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`AMQP sender timed out for ${broker.id}`)), 20_000);
    let settled = false;
    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        callback(value);
      }
    };
    container.once("sendable", () => {
      timer = setInterval(() => {
        if (sender?.sendable()) {
          sender.send({
            to: `topic://${broker.topic}`,
            durable: true,
            message_id: `smoke-${broker.id}-${Date.now()}`,
            body: Buffer.from(`smoke-${broker.id}-${Date.now()}`)
          });
        }
      }, 25);
      finish(resolve);
    });
    container.once("sender_error", (context) => finish(reject, errorFromAmqpContext(context, `AMQP sender failed for ${broker.id}`)));
    sender = connection.open_sender({
      name: `${broker.publisher}-${suffix}`,
      target: { address: `topic://${broker.topic}` }
    });
  });
  await ready;

  return {
    close() {
      clearInterval(timer);
      sender?.close();
      connection.close();
    }
  };
}

async function connectAmqpPair(broker) {
  const suffix = `${process.pid}-${Date.now()}`;
  const subscriber = await openAmqpSubscriber(broker, suffix);
  const publisher = await openAmqpPublisher(broker, suffix);

  return {
    broker,
    get received() {
      return subscriber.received;
    },
    close() {
      publisher.close();
      subscriber.close();
    }
  };
}

function rateFor(snapshot, nodeId) {
  return snapshot.nodes.find((node) => node.id === nodeId)?.metrics?.msgRate ?? 0;
}

async function collectSnapshot() {
  const { loadTopologyConfig, scenarioToFiles } = await import("../apps/api/dist/config/loaders.js");
  const { SempClient } = await import("../apps/api/dist/collector/sempClient.js");
  const { buildTopologySnapshot } = await import("../apps/api/dist/collector/topologyBuilder.js");

  const config = await loadTopologyConfig(path.join(repoRoot, "config/live-docker.yaml"));
  const scenario = config.scenarios.find((item) => item.id === "live-docker");
  const { brokersFile, catalog } = scenarioToFiles(scenario);
  const client = new SempClient();
  const observations = await Promise.all(brokersFile.brokers.map((broker) => client.collectBroker(broker)));
  return buildTopologySnapshot(brokersFile, catalog, observations, { scenarioId: scenario.id, scenarioName: scenario.name });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const amqpPairs = [];
try {
  console.log("Waiting for 5 PubSub+ brokers...");
  await Promise.all(brokers.map(waitForBroker));
  console.log("Configuring client usernames, queues, and subscriptions...");
  await Promise.all(brokers.map(configureBroker));

  console.log("Starting AMQP publisher/subscriber traffic...");
  amqpPairs.push(...(await Promise.all(brokers.map(connectAmqpPair))));
  await sleep(7_000);

  if (trafficOnly) {
    console.log("Live broker traffic is running.");
    setInterval(() => {
      console.log(JSON.stringify({ received: amqpPairs.map((pair) => pair.received) }));
    }, 10_000);
    await new Promise(() => {});
  }

  const snapshot = await collectSnapshot();
  const publisherRates = brokers.map((broker, index) => rateFor(snapshot, `app:live-publisher-${index + 1}`));
  const subscriberRates = brokers.map((broker, index) => rateFor(snapshot, `app:live-subscriber-${index + 1}`));
  const brokerRates = brokers.map((broker) => rateFor(snapshot, `broker:${broker.id}`));

  assert(snapshot.mode === "live", `expected live mode, got ${snapshot.mode}`);
  assert(snapshot.brokerStatuses.length === 5, `expected 5 broker statuses, got ${snapshot.brokerStatuses.length}`);
  assert(snapshot.brokerStatuses.every((status) => status.status === "connected" && status.mode === "live"), "expected all brokers connected in live mode");
  assert(publisherRates.every((rate) => rate > 0), `expected all publisher rates > 0, got ${publisherRates.join(", ")}`);
  assert(subscriberRates.every((rate) => rate > 0), `expected all subscriber rates > 0, got ${subscriberRates.join(", ")}`);
  assert(brokerRates.every((rate) => rate > 0), `expected all broker rates > 0, got ${brokerRates.join(", ")}`);
  assert(amqpPairs.every((pair) => pair.received > 0), `expected all AMQP subscribers to receive messages, got ${amqpPairs.map((pair) => pair.received).join(", ")}`);

  console.log("Live broker smoke passed.");
  console.log(JSON.stringify({ publisherRates, subscriberRates, brokerRates, received: amqpPairs.map((pair) => pair.received) }, null, 2));
} finally {
  for (const pair of amqpPairs) {
    pair.close();
  }
}
