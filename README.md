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
cp .env.example .env
docker compose up --build
```

Services:

- Web UI: <http://localhost:3000>
- API: <http://localhost:8080>
- Neo4j Browser: <http://localhost:7474>

## Real Broker Setup

Edit `config/topology.yaml` to change scenarios, brokers, applications,
subscriptions, and ownership metadata. Broker credentials can be supplied as
environment variable references or entered at runtime from the UI config editor.
Each broker supports basic SEMP credentials or a SEMP API key, plus management
URL, VPN, TLS verification, region, site, and physical location.

The collector uses only read-only SEMP GET requests. It polls every 3 seconds
by default and falls back to the sample topology if no broker can be reached.

## Project Structure

- `apps/api`: Express API, SEMP collector, Neo4j writer, SSE live stream.
- `apps/web`: React topology UI.
- `packages/shared`: Shared TypeScript types and helpers.
- `config`: Single multi-scenario topology YAML.

## License

Apache-2.0.
