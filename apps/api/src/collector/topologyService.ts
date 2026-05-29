import { EventEmitter } from "node:events";
import type { BrokersFile, CatalogFile, MappingSuggestionsResponse, ScenarioSummary, TopologyConfigFile, TopologyScenario, TopologySnapshot } from "@solace-topology/shared";
import { suggestTopologyMappings } from "../ai/liteLlmAssistant.js";
import type { RuntimeConfig } from "../config/env.js";
import { loadTopologyConfig, parseScenarioYaml, scenarioToFiles, stringifyScenarioYaml } from "../config/loaders.js";
import { Neo4jRepository } from "../graph/neo4jRepository.js";
import { buildSampleObservations } from "../sample/sampleData.js";
import { SempClient } from "./sempClient.js";
import { buildTopologySnapshot } from "./topologyBuilder.js";
import type { BrokerObservation } from "./types.js";

type SnapshotListener = (snapshot: TopologySnapshot) => void;

export class TopologyService {
  private readonly events = new EventEmitter();
  private timer: NodeJS.Timeout | undefined;
  private topologyConfig: TopologyConfigFile | undefined;
  private activeScenario: TopologyScenario | undefined;
  private brokersFile: BrokersFile | undefined;
  private catalog: CatalogFile | undefined;
  private snapshot: TopologySnapshot | undefined;
  private polling = false;
  private readonly lastBrokerErrors = new Map<string, string>();

  constructor(
    private readonly config: RuntimeConfig,
    private readonly sempClient = new SempClient(),
    private readonly graph = new Neo4jRepository(config.neo4j.uri, config.neo4j.user, config.neo4j.password, config.neo4j.enabled)
  ) {}

  async start(): Promise<void> {
    this.topologyConfig = await loadTopologyConfig(this.config.topologyConfigPath);
    const initialScenarioId = this.config.defaultScenarioId ?? this.topologyConfig.defaultScenario;
    this.activateScenario(initialScenarioId);
    await this.graph.connect();
    await this.pollOnce();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.graph.close();
  }

  getSnapshot(): TopologySnapshot {
    if (!this.snapshot) {
      throw new Error("Topology service has not produced a snapshot yet");
    }
    return this.snapshot;
  }

  getCatalog(): CatalogFile {
    if (!this.catalog) {
      throw new Error("Topology service has not loaded the catalog yet");
    }
    return this.catalog;
  }

  getActiveScenario(): TopologyScenario {
    if (!this.activeScenario) {
      throw new Error("Topology service has not loaded a scenario yet");
    }
    return this.activeScenario;
  }

  getScenarioSummaries(): { activeScenarioId: string; scenarios: ScenarioSummary[] } {
    if (!this.topologyConfig || !this.activeScenario) {
      throw new Error("Topology service has not loaded scenarios yet");
    }
    return {
      activeScenarioId: this.activeScenario.id,
      scenarios: this.topologyConfig.scenarios.map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        title: scenario.display.title,
        subtitle: scenario.display.subtitle
      }))
    };
  }

  getActiveScenarioYaml(): string {
    return stringifyScenarioYaml(this.getActiveScenario());
  }

  async selectScenario(scenarioId: string): Promise<TopologySnapshot> {
    this.activateScenario(scenarioId);
    return this.pollOnce();
  }

  async replaceActiveScenarioFromYaml(yaml: string): Promise<TopologySnapshot> {
    const current = this.getActiveScenario();
    const scenario = parseScenarioYaml(yaml, current.id);
    this.replaceScenario({ ...scenario, id: current.id, name: scenario.name || current.name });
    return this.pollOnce();
  }

  async replaceActiveScenario(scenario: TopologyScenario): Promise<TopologySnapshot> {
    this.replaceScenario(parseScenarioYaml(stringifyScenarioYaml(scenario), scenario.id));
    return this.pollOnce();
  }

  subscribe(listener: SnapshotListener): () => void {
    this.events.on("snapshot", listener);
    if (this.snapshot) {
      listener(this.snapshot);
    }
    return () => this.events.off("snapshot", listener);
  }

  async suggestMappings(): Promise<MappingSuggestionsResponse> {
    return suggestTopologyMappings(this.getActiveScenario().aiAssistant, this.getActiveScenario(), this.getSnapshot());
  }

  async pollOnce(): Promise<TopologySnapshot> {
    if (this.polling) {
      return this.getSnapshot();
    }
    if (!this.brokersFile || !this.catalog || !this.activeScenario) {
      if (!this.topologyConfig) {
        this.topologyConfig = await loadTopologyConfig(this.config.topologyConfigPath);
      }
      this.activateScenario(this.config.defaultScenarioId ?? this.topologyConfig.defaultScenario);
    }

    this.polling = true;
    try {
      const observations = await this.collectObservations(this.brokersFile!, this.catalog!);
      const snapshot = buildTopologySnapshot(this.brokersFile!, this.catalog!, observations, {
        scenarioId: this.activeScenario!.id,
        scenarioName: this.activeScenario!.name
      });
      this.snapshot = snapshot;
      await this.graph.writeSnapshot(snapshot);
      this.events.emit("snapshot", snapshot);
      return snapshot;
    } finally {
      this.polling = false;
    }
  }

  private activateScenario(scenarioId: string): void {
    if (!this.topologyConfig) {
      throw new Error("Topology config is not loaded");
    }
    const scenario = this.topologyConfig.scenarios.find((item) => item.id === scenarioId) ?? this.topologyConfig.scenarios[0];
    if (!scenario) {
      throw new Error("No scenarios are configured");
    }
    this.activeScenario = scenario;
    const files = scenarioToFiles(scenario);
    this.brokersFile = files.brokersFile;
    this.catalog = files.catalog;
    this.snapshot = undefined;
    this.lastBrokerErrors.clear();
  }

  private replaceScenario(scenario: TopologyScenario): void {
    if (!this.topologyConfig || !this.activeScenario) {
      throw new Error("Topology config is not loaded");
    }
    const scenarioIndex = this.topologyConfig.scenarios.findIndex((item) => item.id === this.activeScenario!.id);
    const nextScenario = { ...scenario, id: this.activeScenario.id };
    if (scenarioIndex >= 0) {
      this.topologyConfig.scenarios[scenarioIndex] = nextScenario;
    } else {
      this.topologyConfig.scenarios.push(nextScenario);
    }
    this.activeScenario = nextScenario;
    const files = scenarioToFiles(nextScenario);
    this.brokersFile = files.brokersFile;
    this.catalog = files.catalog;
    this.snapshot = undefined;
    this.lastBrokerErrors.clear();
  }

  private async collectObservations(brokersFile: BrokersFile, catalog: CatalogFile): Promise<BrokerObservation[]> {
    const liveObservations: BrokerObservation[] = [];
    const failedBrokerIds: string[] = [];

    await Promise.all(
      brokersFile.brokers.map(async (broker) => {
        try {
          liveObservations.push(await this.sempClient.collectBroker(broker));
          this.lastBrokerErrors.delete(broker.id);
        } catch (error) {
          const message = (error as Error).message;
          failedBrokerIds.push(broker.id);
          if (this.lastBrokerErrors.get(broker.id) !== message) {
            console.warn(`Broker ${broker.id} unavailable: ${message}`);
            this.lastBrokerErrors.set(broker.id, message);
          }
        }
      })
    );

    if (failedBrokerIds.length === 0) {
      return liveObservations;
    }

    if (!this.config.sampleFallbackEnabled) {
      const failedObservations = brokersFile.brokers
        .filter((broker) => failedBrokerIds.includes(broker.id))
        .map<BrokerObservation>((broker) => ({
          brokerId: broker.id,
          mode: "live",
          clients: [],
          queues: [],
          subscriptions: [],
          status: {
            brokerId: broker.id,
            displayName: broker.displayName,
            status: "unreachable",
            mode: "live",
            lastPollAt: new Date().toISOString(),
            error: "Broker unavailable or credentials missing"
          }
        }));
      return [...liveObservations, ...failedObservations];
    }

    const fallback = buildSampleObservations(brokersFile, catalog, failedBrokerIds);
    return [...liveObservations, ...fallback];
  }
}
