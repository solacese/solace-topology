# Solace Topology

Open-source proof of concept for mapping a Solace PubSub+ event mesh: brokers,
publishers, subscribers, topic provenance, ownership, and
live throughput.

The first demo profile models a public automotive event mesh with 10 brokers,
15 publishers, and 5 subscribers. It connects to real
brokers through read-only SEMP v2 when configured, and falls back to a built-in
sample topology for offline demos.

## Quick Start

```bash
npm install
npm run dev
```

Open the web app at <http://localhost:5173>. The API runs on
<http://localhost:8080>.

## Docker Compose

```bash
docker compose up --build
```

Services:

- Web UI: <http://localhost:3000>
- API: <http://localhost:8080>
- Neo4j Browser: <http://localhost:7474>

The `.env` file is optional. Create one from `.env.example` when you want to
override ports, Neo4j settings, polling interval, or production broker
credentials.

## Live Local Broker Smoke

To validate real SEMP and MQTT behavior locally, run five PubSub+ Standard
brokers with publisher/subscriber traffic:

```bash
docker compose -f docker-compose.yml -f docker-compose.live-test.yml up --build
npm run test:live-brokers
```

The live fixture config is `config/live-docker.yaml`. It creates five local
brokers, five MQTT publisher clients, five MQTT subscriber clients, queues, and
subscriptions, then verifies the API collector reports `live` mode with
non-zero publisher, broker, and subscriber rates.

Stop the fixture with:

```bash
docker compose -f docker-compose.yml -f docker-compose.live-test.yml down
```

## Real Broker Setup

Use **Settings** in the top-right of the app for guided setup:

- Broker connectivity: management URL, VPN, physical location, basic
  credentials, or SEMP API key.
- Event Portal metadata source: API base URL, token environment variable,
  application domain ID, environment ID, and sync mode.
- Metadata mapping: publishers, subscribers, provenance, owners, cost centers,
  client matchers, queue matchers, and topic mappings.
- Discovered runtime inventory: broker health, queues, topic patterns,
  subscriptions, and links collected from broker polling.
- YAML Config: bulk edits to the full active scenario.

Broker and Event Portal credentials can be supplied as environment variable
references for production deployments.

The collector uses only read-only SEMP GET requests. It polls every 3 seconds
by default and falls back to the sample topology if no broker can be reached.

## Project Structure

- `apps/api`: Express API, SEMP collector, Neo4j writer, SSE live stream.
- `apps/web`: React topology UI.
- `packages/shared`: Shared TypeScript types and helpers.
- `config`: Single multi-scenario topology YAML.

## License

Apache-2.0.
