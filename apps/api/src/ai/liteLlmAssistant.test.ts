import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiAssistantConfig, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";
import { suggestTopologyMappings } from "./liteLlmAssistant.js";

const scenario: TopologyScenario = {
  id: "test",
  name: "Test",
  display: { title: "Test", subtitle: "" },
  brokers: [
    {
      id: "broker-a",
      displayName: "Broker A",
      managementUrl: "http://localhost:8080",
      messageVpns: ["default"],
      region: "emea",
      site: "paris",
      environment: "test",
      tlsRejectUnauthorized: false,
      tags: ["edge"]
    }
  ],
  links: [],
  owners: [{ id: "ops", displayName: "Ops" }],
  costCenters: [{ id: "ops", displayName: "Ops" }],
  applications: [
    {
      id: "publisher-a",
      displayName: "Publisher A",
      role: "emitter",
      provenance: "IoT",
      owner: "ops",
      costCenter: "ops",
      brokerIds: ["broker-a"],
      publishTopicPrefixes: ["plant/a/>"]
    }
  ]
};

const snapshot: TopologySnapshot = {
  generatedAt: "2026-05-29T10:00:00.000Z",
  mode: "sample",
  scenarioId: "test",
  scenarioName: "Test",
  title: "Test",
  subtitle: "",
  nodes: [
    { id: "broker:broker-a", type: "Broker", label: "Broker A", metrics: { msgRate: 42 } },
    { id: "app:publisher-a", type: "Application", label: "Publisher A", metrics: { msgRate: 42 }, metadata: { role: "emitter" } }
  ],
  edges: [],
  brokerStatuses: [{ brokerId: "broker-a", displayName: "Broker A", status: "sample", mode: "sample" }],
  summary: {
    totalMsgRate: 42,
    totalByteRate: 4200,
    brokerCount: 1,
    emittingApplicationCount: 1,
    listeningApplicationCount: 0,
    byBroker: [],
    byProvenance: [],
    byOwner: [],
    byCostCenter: []
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEST_LITELLM_KEY;
});

describe("LiteLLM mapping assistant", () => {
  it("requires the helper to be enabled", async () => {
    await expect(suggestTopologyMappings(undefined, scenario, snapshot)).rejects.toThrow("AI helper is not enabled");
  });

  it("posts compact topology context to a LiteLLM-compatible endpoint", async () => {
    process.env.TEST_LITELLM_KEY = "secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "## Mapping gaps\n- None" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const config: AiAssistantConfig = {
      enabled: true,
      baseUrl: "http://litellm.local/v1",
      apiKeyEnv: "TEST_LITELLM_KEY",
      model: "gpt-4o-mini"
    };

    const suggestion = await suggestTopologyMappings(config, scenario, snapshot);
    const [, init] = fetchMock.mock.calls[0]!;
    const payload = JSON.parse(String(init?.body));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://litellm.local/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret" })
      })
    );
    expect(payload.model).toBe("gpt-4o-mini");
    expect(payload.messages[1].content).toContain("Publisher A");
    expect(suggestion.context).toMatchObject({ brokers: 1, publishers: 1, subscribers: 0 });
    expect(suggestion.content).toContain("Mapping gaps");
  });

  it("retries /v1/chat/completions when a root LiteLLM URL returns 404", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Use queue matcher Q.A" } }] }), { status: 200 }));

    const suggestion = await suggestTopologyMappings(
      {
        enabled: true,
        baseUrl: "http://litellm.local",
        model: "gpt-4o-mini",
        temperature: 0
      },
      scenario,
      snapshot
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://litellm.local/chat/completions", "http://litellm.local/v1/chat/completions"]);
    expect(suggestion.content).toBe("Use queue matcher Q.A");
  });
});
