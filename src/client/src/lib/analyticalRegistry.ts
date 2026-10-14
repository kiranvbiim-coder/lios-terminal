import {
  analyticalFingerprint,
  executeAnalyticalModel,
  type AnalyticalExecutionContext,
  type AnalyticalModelDefinition,
  type AnalyticalModelRun,
} from "./analyticalCore";
import { applyAnalyticalScenario, type AnalyticalScenario, type ScenarioChange } from "./analyticalScenario";

export interface AnalyticalRegistryRun<TPayload = unknown> {
  run: AnalyticalModelRun;
  payload: TPayload;
  scenarioChanges: ScenarioChange[];
}

export interface AnalyticalRunOptions {
  objectId?: string;
  scenario?: AnalyticalScenario;
  runAt?: string;
  metadata?: Record<string, unknown>;
}

export class AnalyticalModelRegistry {
  private readonly models = new Map<string, AnalyticalModelDefinition<unknown>>();

  register<TPayload>(definition: AnalyticalModelDefinition<TPayload>): this {
    const existing = this.models.get(definition.id);
    if (existing && existing.version !== definition.version) {
      throw new Error(`Analytical model ${definition.id} is already registered at version ${existing.version}.`);
    }
    this.models.set(definition.id, definition as AnalyticalModelDefinition<unknown>);
    return this;
  }

  has(modelId: string): boolean {
    return this.models.has(modelId);
  }

  get<TPayload = unknown>(modelId: string): AnalyticalModelDefinition<TPayload> {
    const definition = this.models.get(modelId);
    if (!definition) throw new Error(`Unknown analytical model: ${modelId}`);
    return definition as AnalyticalModelDefinition<TPayload>;
  }

  list(): AnalyticalModelDefinition<unknown>[] {
    return Array.from(this.models.values()).sort((a, b) => a.domain.localeCompare(b.domain) || a.label.localeCompare(b.label));
  }

  listByDomain(domain: string): AnalyticalModelDefinition<unknown>[] {
    return this.list().filter((definition) => definition.domain === domain);
  }

  run<TPayload>(modelId: string, payload: TPayload, options: AnalyticalRunOptions = {}): AnalyticalRegistryRun<TPayload> {
    const definition = this.get<TPayload>(modelId);
    const application = options.scenario ? applyAnalyticalScenario(payload, options.scenario) : null;
    const effectivePayload = application?.payload ?? payload;
    const scenario = options.scenario
      ? {
          id: options.scenario.id,
          label: options.scenario.label,
          fingerprint: application?.fingerprint ?? analyticalFingerprint(options.scenario),
        }
      : undefined;
    const context: AnalyticalExecutionContext = {
      objectId: options.objectId,
      scenario,
      runAt: options.runAt,
      metadata: {
        ...(options.metadata ?? {}),
        ...(application ? { scenarioChanges: application.changes } : {}),
      },
    };
    return {
      run: executeAnalyticalModel(definition, effectivePayload, context),
      payload: effectivePayload,
      scenarioChanges: application?.changes ?? [],
    };
  }
}

export const analyticalModelRegistry = new AnalyticalModelRegistry();
