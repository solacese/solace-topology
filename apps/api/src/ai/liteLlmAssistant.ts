import type { AiAssistantConfig, MappingSuggestionsResponse, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";

interface LiteLlmChatCompletion {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function liteLlmEndpoints(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return [normalized];
  }
  if (normalized.endsWith("/v1")) {
    return [`${normalized}/chat/completions`];
  }
  return [`${normalized}/chat/completions`, `${normalized}/v1/chat/completions`];
}

function apiKey(config: AiAssistantConfig): string | undefined {
  if (config.apiKey) {
    return config.apiKey;
  }
  if (config.apiKeyEnv) {
    return process.env[config.apiKeyEnv];
  }
  return undefined;
}

function parseResponse(text: string): (LiteLlmChatCompletion & { error?: { message?: string } }) | undefined {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as LiteLlmChatCompletion & { error?: { message?: string } };
  } catch {
    return { error: { message: text.slice(0, 400) } };
  }
}

function compactScenario(scenario: TopologyScenario) {
  return {
    id: scenario.id,
    brokers: scenario.brokers.map((broker) => ({
      id: broker.id,
      displayName: broker.displayName,
      site: broker.site,
      physicalLocation: broker.physicalLocation,
      amqpUrl: broker.amqpUrl,
      messagingProtocols: broker.messagingProtocols,
      tags: broker.tags
    })),
    links: scenario.links,
    applications: scenario.applications.map((app) => ({
      id: app.id,
      displayName: app.displayName,
      role: app.role,
      provenance: app.provenance,
      owner: app.owner,
      costCenter: app.costCenter,
      messagingProtocol: app.messagingProtocol,
      brokerIds: app.brokerIds,
      clientMatchers: app.clientMatchers,
      usernameMatchers: app.usernameMatchers,
      queueMatchers: app.queueMatchers,
      publishTopicPrefixes: app.publishTopicPrefixes,
      listen: app.listen
    }))
  };
}

function compactRuntime(snapshot: TopologySnapshot) {
  const queues = snapshot.nodes.filter((node) => node.type === "Queue");
  const topics = snapshot.nodes.filter((node) => node.type === "TopicPattern");
  const brokers = snapshot.nodes.filter((node) => node.type === "Broker");
  const publishers = snapshot.nodes.filter((node) => node.type === "Application" && ["emitter", "both"].includes(String(node.metadata?.role ?? "")));
  const subscribers = snapshot.nodes.filter((node) => node.type === "Application" && ["listener", "both"].includes(String(node.metadata?.role ?? "")));
  return {
    mode: snapshot.mode,
    brokerStatuses: snapshot.brokerStatuses,
    brokers: brokers.map((node) => ({ id: node.id, label: node.label, msgRate: node.metrics?.msgRate, status: node.status, metadata: node.metadata })),
    publishers: publishers.map((node) => ({ id: node.id, label: node.label, msgRate: node.metrics?.msgRate, metadata: node.metadata })),
    subscribers: subscribers.map((node) => ({ id: node.id, label: node.label, msgRate: node.metrics?.msgRate, metadata: node.metadata })),
    queues: queues.map((node) => ({ id: node.id, label: node.label, msgRate: node.metrics?.msgRate, metadata: node.metadata })),
    topics: topics.map((node) => ({ id: node.id, label: node.label, msgRate: node.metrics?.msgRate, metadata: node.metadata })),
    subscriptions: snapshot.edges
      .filter((edge) => edge.type === "SUBSCRIBES_TO")
      .map((edge) => ({ source: edge.source, target: edge.target, confidence: edge.confidence, msgRate: edge.metrics?.msgRate })),
    links: snapshot.edges
      .filter((edge) => edge.type === "LINKED_TO")
      .map((edge) => ({ source: edge.source, target: edge.target, label: edge.label, msgRate: edge.metrics?.msgRate }))
  };
}

function contextCounts(snapshot: TopologySnapshot): MappingSuggestionsResponse["context"] {
  return {
    brokers: snapshot.nodes.filter((node) => node.type === "Broker").length,
    publishers: snapshot.nodes.filter((node) => node.type === "Application" && ["emitter", "both"].includes(String(node.metadata?.role ?? ""))).length,
    subscribers: snapshot.nodes.filter((node) => node.type === "Application" && ["listener", "both"].includes(String(node.metadata?.role ?? ""))).length,
    queues: snapshot.nodes.filter((node) => node.type === "Queue").length,
    subscriptions: snapshot.edges.filter((edge) => edge.type === "SUBSCRIBES_TO").length,
    topics: snapshot.nodes.filter((node) => node.type === "TopicPattern").length
  };
}

export async function suggestTopologyMappings(config: AiAssistantConfig | undefined, scenario: TopologyScenario, snapshot: TopologySnapshot): Promise<MappingSuggestionsResponse> {
  if (!config?.enabled) {
    throw new Error("AI helper is not enabled in Settings");
  }
  if (!config.baseUrl || !config.model) {
    throw new Error("AI helper requires a LiteLLM base URL and model");
  }

  const key = apiKey(config);
  const body = JSON.stringify({
    model: config.model,
    temperature: config.temperature ?? 0.2,
    messages: [
      {
        role: "system",
        content:
          "You help Solace customers map broker runtime data to business metadata. Be precise and conservative. Do not invent credentials. Do not claim exact per-topic publisher throughput from broker data alone."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task:
              "Review this topology setup and return concise Markdown with: mapping gaps, likely client/queue/topic matcher improvements, Event Portal fields to fill, and YAML patch snippets where useful.",
            scenario: compactScenario(scenario),
            runtime: compactRuntime(snapshot)
          },
          null,
          2
        )
      }
    ]
  });

  let lastError = "";
  for (const endpoint of liteLlmEndpoints(config.baseUrl)) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {})
      },
      body,
      signal: AbortSignal.timeout(45_000)
    });

    const text = await response.text();
    const payload = parseResponse(text);
    if (!response.ok) {
      lastError = payload?.error?.message ?? `LiteLLM request failed with ${response.status}`;
      if (response.status === 404) {
        continue;
      }
      throw new Error(lastError);
    }

    const content = payload?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LiteLLM returned an empty mapping suggestion");
    }

    return {
      provider: "litellm",
      model: config.model,
      generatedAt: new Date().toISOString(),
      content,
      context: contextCounts(snapshot)
    };
  }
  throw new Error(lastError || "LiteLLM endpoint was not found");
}
