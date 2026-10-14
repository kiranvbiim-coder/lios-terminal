import { liosCapabilitySchema, type CapabilityExecutionTarget, type CapabilitySurface, type LiOSCapability } from "@shared/capability";
import {
  BUILT_IN_CONNECTORS,
  type ConnectorCapability,
  type ConnectorDefinition,
} from "@shared/connectorRegistry";
import type { QuantModelRegistryEntry } from "@shared/quantModelRegistry";
import { ADVANCED_QUANT_REGISTRY } from "./advancedQuantRegistry";
import { ADVANCED_QUANT_DEPTH2_REGISTRY } from "./advancedQuantRegistryDepth2";

export type CapabilityQuery = {
  category?: string;
  surface?: CapabilitySurface;
  executionTarget?: CapabilityExecutionTarget;
  availability?: LiOSCapability["availability"]["state"];
  text?: string;
};

function cloneCapability(capability: LiOSCapability): LiOSCapability {
  return liosCapabilitySchema.parse(capability);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function stableSegment(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Small in-memory index for product-wide capability discovery.
 *
 * It deliberately owns no execution logic. Existing engines remain
 * authoritative; this registry gives UI, AI, automation and future MCP one
 * common way to discover what LiOS can do.
 */
export class CapabilityRegistry {
  private readonly capabilities = new Map<string, LiOSCapability>();

  register(capability: unknown): LiOSCapability {
    const parsed = liosCapabilitySchema.parse(capability);
    if (this.capabilities.has(parsed.id)) {
      throw new Error(`Duplicate LiOS capability id: ${parsed.id}`);
    }
    this.capabilities.set(parsed.id, parsed);
    return cloneCapability(parsed);
  }

  registerMany(capabilities: readonly unknown[]): LiOSCapability[] {
    const parsed = capabilities.map((capability) => liosCapabilitySchema.parse(capability));
    const incomingIds = new Set<string>();
    for (const capability of parsed) {
      if (incomingIds.has(capability.id) || this.capabilities.has(capability.id)) {
        throw new Error(`Duplicate LiOS capability id: ${capability.id}`);
      }
      incomingIds.add(capability.id);
    }
    for (const capability of parsed) this.capabilities.set(capability.id, capability);
    return parsed.map(cloneCapability);
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  get(id: string): LiOSCapability | undefined {
    const capability = this.capabilities.get(id);
    return capability ? cloneCapability(capability) : undefined;
  }

  list(): LiOSCapability[] {
    return [...this.capabilities.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneCapability);
  }

  find(query: CapabilityQuery = {}): LiOSCapability[] {
    const text = query.text ? normalize(query.text) : null;
    return this.list().filter((capability) => {
      if (query.category && capability.category !== query.category) return false;
      if (query.surface && !capability.surfaces.includes(query.surface)) return false;
      if (query.executionTarget && capability.execution.target !== query.executionTarget) return false;
      if (query.availability && capability.availability.state !== query.availability) return false;
      if (!text) return true;
      const haystack = [
        capability.id,
        capability.name,
        capability.description,
        capability.category,
        ...capability.tags,
        ...capability.uiHints.existingSurfaces,
        capability.uiHints.preferredView ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(text);
    });
  }
}

function quantExecutionTarget(engine: QuantModelRegistryEntry["engine"]): CapabilityExecutionTarget {
  switch (engine) {
    case "python_sidecar": return "python_sidecar";
    case "typescript": return "typescript";
    case "data_service": return "data_service";
    case "ai_interpretation": return "ai_provider";
    case "spreadsheet": return "external_provider";
  }
}

function quantAvailability(status: QuantModelRegistryEntry["status"]): LiOSCapability["availability"] {
  switch (status) {
    case "validated":
    case "implemented":
      return { state: "available" };
    case "experimental":
    case "synthetic":
      return { state: "experimental", reason: `Quant model status is ${status}.` };
    case "planned":
      return { state: "disabled", reason: "Quant model is planned but not implemented." };
  }
}

function preferredViewForQuant(entry: QuantModelRegistryEntry): string {
  switch (entry.category) {
    case "valuation": return "valuation";
    case "portfolio_optimization": return "optimizer";
    case "fixed_income": return "fixedincome";
    case "derivatives": return "options";
    case "credit_risk":
    case "risk": return "advancedrisk";
    case "macro": return "macrodashboard";
    case "supply_chain": return "supplychainquant";
    case "climate": return "environmentquant";
    case "research_intelligence": return "research";
    case "financial_modelling": return "integratedmodel";
    case "decision_intelligence": return "decisionengine";
    case "econometrics":
    case "forecasting":
    default:
      return "quantworkbench";
  }
}

export function quantModelToCapability(entry: QuantModelRegistryEntry): LiOSCapability {
  const isSeeded = entry.determinism === "seeded_stochastic";
  const isReproducible = entry.determinism === "deterministic" || isSeeded;
  const commonInvocable = entry.engine === "python_sidecar" && Boolean(entry.engineEndpoint?.startsWith("/advanced/"));
  return liosCapabilitySchema.parse({
    id: entry.id,
    name: entry.label,
    description: `${entry.label} quantitative capability backed by the existing LiOS ${entry.engine} engine.`,
    category: entry.category,
    version: entry.version,
    availability: quantAvailability(entry.status),
    execution: {
      target: quantExecutionTarget(entry.engine),
      endpoint: entry.apiEndpoint,
      handlerId: commonInvocable ? `capability:${entry.id}` : undefined,
      deterministic: isReproducible,
      seeded: isSeeded,
    },
    surfaces: ["api", "command_palette", "master_ai", "automation", "workspace"],
    permissions: [],
    entitlements: [],
    contextRequirements: [],
    tags: [entry.category, entry.program, entry.engine, entry.determinism, ...entry.components],
    schemaRefs: {},
    uiHints: {
      existingSurfaces: entry.surfaces,
      preferredView: preferredViewForQuant(entry),
    },
    aiHints: {
      invocable: commonInvocable,
      requiresConfirmation: false,
    },
    source: {
      kind: "internal",
      sourceId: "quant-model-registry",
      files: entry.sourceFiles,
    },
  });
}

const ALL_ADVANCED_QUANT_REGISTRY: QuantModelRegistryEntry[] = [
  ...ADVANCED_QUANT_REGISTRY,
  ...ADVANCED_QUANT_DEPTH2_REGISTRY,
];

export function advancedQuantCapabilities(): LiOSCapability[] {
  return ALL_ADVANCED_QUANT_REGISTRY.map(quantModelToCapability);
}

function groupConnectorCapabilities(capabilities: readonly ConnectorCapability[]): Map<string, ConnectorCapability[]> {
  const groups = new Map<string, ConnectorCapability[]>();
  for (const capability of capabilities) {
    const family = stableSegment(capability.contractFamily);
    const existing = groups.get(family) ?? [];
    existing.push(capability);
    groups.set(family, existing);
  }
  return groups;
}

function connectorContextRequirements(definition: ConnectorDefinition): string[] {
  if (definition.authMode === "none" || definition.authMode === "local") return [];
  return [`connector:${definition.id}`];
}

function connectorExecutionTarget(definition: ConnectorDefinition): CapabilityExecutionTarget {
  if (definition.category === "ai" || definition.sourceType === "local_model") return "ai_provider";
  return "data_service";
}

export function connectorDefinitionToCapabilities(definition: ConnectorDefinition): LiOSCapability[] {
  const grouped = groupConnectorCapabilities(definition.capabilities);
  return [...grouped.entries()].map(([family, capabilities]) => {
    const fields = [...new Set(capabilities.flatMap((capability) => capability.fields ?? []))];
    const coverage = [...new Set(capabilities.map((capability) => capability.coverage).filter((value): value is string => Boolean(value)))];
    const availability: LiOSCapability["availability"] = definition.adapterImplemented
      ? {
          state: "configurable",
          reason: "Adapter code exists; live availability is resolved from the user-scoped connector runtime.",
        }
      : {
          state: "disabled",
          reason: "Connector is catalog-only; no runtime adapter is implemented yet.",
        };
    const coverageText = coverage.length ? ` Coverage: ${coverage.join(", ")}.` : "";
    const visibleFields = fields.slice(0, 20);
    const fieldText = visibleFields.length
      ? ` Fields: ${visibleFields.join(", ")}${fields.length > visibleFields.length ? ` (+${fields.length - visibleFields.length} more)` : ""}.`
      : "";

    return liosCapabilitySchema.parse({
      id: `connector.${stableSegment(definition.id)}.${family}`,
      name: `${definition.name}: ${capabilities[0].contractFamily}`,
      description: `${definition.description ?? definition.name} Provides the ${capabilities[0].contractFamily} data contract.${coverageText}${fieldText}`,
      category: `data.${stableSegment(definition.category)}`,
      version: "1.0.0",
      availability,
      execution: {
        target: connectorExecutionTarget(definition),
        handlerId: `connector:${definition.id}:${family}`,
        deterministic: false,
        seeded: false,
      },
      surfaces: ["command_palette", "master_ai", "workspace"],
      permissions: [],
      entitlements: [],
      contextRequirements: connectorContextRequirements(definition),
      tags: [
        definition.id,
        definition.name,
        definition.category,
        definition.sourceType,
        definition.authMode,
        definition.custodyMode,
        capabilities[0].contractFamily,
        ...fields,
      ].slice(0, 100),
      schemaRefs: {},
      uiHints: {
        existingSurfaces: ["Connection Center"],
        preferredView: "connectors",
      },
      aiHints: {
        invocable: false,
        requiresConfirmation: false,
      },
      source: {
        kind: "connector",
        sourceId: definition.id,
        files: ["shared/connectorRegistry.ts"],
      },
    });
  });
}

export function connectorCapabilities(definitions: readonly ConnectorDefinition[] = BUILT_IN_CONNECTORS): LiOSCapability[] {
  return definitions.flatMap(connectorDefinitionToCapabilities);
}

export function createDefaultCapabilityRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.registerMany(advancedQuantCapabilities());
  registry.registerMany(connectorCapabilities());
  return registry;
}

export const capabilityRegistry = createDefaultCapabilityRegistry();
