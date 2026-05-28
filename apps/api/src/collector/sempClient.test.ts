import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrokerConfig } from "@solace-topology/shared";
import { SempClient } from "./sempClient.js";

let server: http.Server;
let baseUrl = "";

beforeEach(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const url = req.url ?? "";
    if (url.includes("/clients") && !url.includes("cursor=2")) {
      res.end(
        JSON.stringify({
          data: [
            {
              clientName: "veh-telemetry-a",
              clientUsername: "vehicle-iot-a",
              rxMsgRate: 42,
              rxByteRate: 4200
            }
          ],
          meta: { paging: { cursorQuery: "?cursor=2" } }
        })
      );
      return;
    }
    if (url.includes("/clients") && url.includes("cursor=2")) {
      res.end(
        JSON.stringify({
          data: [
            {
              clientName: "mfg-analytics-a",
              originalClientUsername: "analytics",
              averageTxMsgRate: 24,
              averageTxByteRate: 2400
            }
          ]
        })
      );
      return;
    }
    if (url.includes("/queues/") && url.includes("/subscriptions")) {
      res.end(JSON.stringify({ data: [{ subscriptionTopic: "plant/>" }] }));
      return;
    }
    if (url.includes("/queues")) {
      res.end(JSON.stringify({ data: [{ queueName: "Q.MFG.ANALYTICS", bindCount: 2, currentMessagesSpooled: 7 }] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("SEMP client", () => {
  it("normalizes paginated read-only SEMP responses", async () => {
    process.env.TEST_SEMP_USER = "admin";
    process.env.TEST_SEMP_PASSWORD = "admin";
    const broker: BrokerConfig = {
      id: "test-broker",
      displayName: "Test Broker",
      managementUrl: baseUrl,
      messageVpns: ["default"],
      region: "test",
      site: "test",
      environment: "test",
      usernameEnv: "TEST_SEMP_USER",
      passwordEnv: "TEST_SEMP_PASSWORD",
      tlsRejectUnauthorized: true,
      tags: []
    };

    const observation = await new SempClient().collectBroker(broker);
    expect(observation.clients).toHaveLength(2);
    expect(observation.clients[0]?.username).toBe("vehicle-iot-a");
    expect(observation.clients[0]?.ingressMsgRate).toBe(42);
    expect(observation.clients[1]?.username).toBe("analytics");
    expect(observation.clients[1]?.egressMsgRate).toBe(24);
    expect(observation.queues[0]?.name).toBe("Q.MFG.ANALYTICS");
    expect(observation.subscriptions[0]?.topic).toBe("plant/>");
  });
});
