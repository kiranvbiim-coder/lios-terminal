import { z } from "zod";
import { artifactKindSchema } from "./artifactContracts";
import type { ArtifactRendererAdapter, ConnectorAdapter } from "./runtimeAdapters";
import type {
  AgentAdapter,
  RuntimeAdapter,
  RuntimeComponentKind,
  ToolAdapter,
} from "./runtimeContracts";

export const LIOS_PLUGIN_SDK_VERSION = "1" as const;
export const LIOS_PLUGIN_HOST_VERSION = "1.0.0" as const;

const pluginIdSchema = z.string().trim().min(3).max(180).regex(/^[a-z0-9][a-z0-9._-]*$/);
const componentIdSchema = z.string().trim().min(1).max(300).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const semverSchema = z.string().trim().regex(/^\d+\.\d+\.\d+$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const versionRangeSchema = z.string().trim().regex(/^(?:\^|~|>=|<=|>|<)?\d+\.\d+\.\d+$/);

export const pluginRuntimeKindSchema = z.enum([
  "declarative",
  "node_process",
  "python_sidecar",
  "external_process",
]);
export type PluginRuntimeKind = z.infer<typeof pluginRuntimeKindSchema>;

export const pluginPermissionSchema = z.enum([
  "project.read",
  "project.write",
  "artifact.read",
  "artifact.write",
  "connector.credentials",
  "ai.invoke",
  "network.http",
  "filesystem.project.read",
  "filesystem.project.write",
  "filesystem.user_selected.read",
  "filesystem.user_selected.write",
  "process.spawn",
]);
export type PluginPermission = z.infer<typeof pluginPermissionSchema>;

const pluginContributionSchema = z.object({
  id: componentIdSchema,
  componentId: componentIdSchema,
  name: z.string().trim().min(1).max(240),
  capabilities: z.array(componentIdSchema).max(200).default([]),
}).strict();
export type PluginContribution = z.infer<typeof pluginContributionSchema>;

export const pluginArtifactContributionSchema = pluginContributionSchema.extend({
  artifactKinds: z.array(artifactKindSchema).min(1).max(20),
}).strict();
export type PluginArtifactContribution = z.infer<typeof pluginArtifactContributionSchema>;

/** Declarative skill contribution (SI-02.16). Carries metadata and a governed-tool allow-list, never code. */
export const pluginSkillContributionSchema = pluginContributionSchema.extend({
  description: z.string().trim().max(2_000).default(""),
  updatedAt: z.string().datetime(),
  requiredInputs: z.array(componentIdSchema).max(100).default([]),
  supportedObjectKinds: z.array(componentIdSchema).max(20).default([]),
  toolIds: z.array(componentIdSchema).max(100).default([]),
}).strict().superRefine((skill, ctx) => {
  for (const key of ["requiredInputs", "supportedObjectKinds", "toolIds"] as const) {
    if (new Set(skill[key]).size !== skill[key].length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Skill " + key + " must be unique." });
    }
  }
});
export type PluginSkillContribution = z.infer<typeof pluginSkillContributionSchema>;

const pluginDependencySchema = z.object({
  pluginId: pluginIdSchema,
  versionRange: versionRangeSchema,
}).strict();
export type PluginDependency = z.infer<typeof pluginDependencySchema>;

export const liosPluginManifestV1Schema = z.object({
  apiVersion: z.literal(LIOS_PLUGIN_SDK_VERSION),
  id: pluginIdSchema,
  name: z.string().trim().min(1).max(240),
  version: semverSchema,
  description: z.string().trim().max(2_000).default(""),
  publisher: z.string().trim().min(1).max(240),
  lios: z.object({
    sdkVersion: z.literal(LIOS_PLUGIN_SDK_VERSION),
    minVersion: semverSchema,
    maxVersion: semverSchema.nullable().default(null),
  }).strict(),
  runtime: z.object({
    kind: pluginRuntimeKindSchema,
    entrypoint: z.string().trim().min(1).max(1_000).nullable().default(null),
  }).strict(),
  dependencies: z.array(pluginDependencySchema).max(100).default([]),
  permissions: z.array(pluginPermissionSchema).max(100).default([]),
  connectors: z.array(pluginContributionSchema).max(200).default([]),
  tools: z.array(pluginContributionSchema).max(500).default([]),
  artifacts: z.array(pluginArtifactContributionSchema).max(200).default([]),
  agents: z.array(pluginContributionSchema).max(200).default([]),
  skills: z.array(pluginSkillContributionSchema).max(200).default([]),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    digest: sha256Schema,
  }).strict().nullable().default(null),
  signer: z.object({
    algorithm: z.literal("ed25519"),
    keyId: componentIdSchema,
    signature: z.string().trim().min(40).max(2_000),
  }).strict().nullable().default(null),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.runtime.kind !== "declarative" && !manifest.runtime.entrypoint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtime", "entrypoint"],
      message: "Executable plugin runtimes require an entrypoint.",
    });
  }

  if (manifest.runtime.kind === "declarative" && manifest.runtime.entrypoint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtime", "entrypoint"],
      message: "Declarative plugins must not declare an executable entrypoint.",
    });
  }

  if ((manifest.integrity === null) !== (manifest.signer === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["integrity"],
      message: "Signed plugin manifests must declare both package integrity and signer metadata.",
    });
  }

  if (manifest.lios.maxVersion && compareVersionStrings(manifest.lios.maxVersion, manifest.lios.minVersion) < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lios", "maxVersion"],
      message: "LiOS maxVersion must be greater than or equal to minVersion.",
    });
  }

  const permissionSet = new Set(manifest.permissions);
  if (permissionSet.size !== manifest.permissions.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["permissions"],
      message: "Plugin permissions must be unique.",
    });
  }

  const dependencyIds = manifest.dependencies.map((dependency) => dependency.pluginId);
  if (new Set(dependencyIds).size !== dependencyIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dependencies"],
      message: "Plugin dependencies must be unique.",
    });
  }
  if (dependencyIds.includes(manifest.id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dependencies"],
      message: "A plugin cannot depend on itself.",
    });
  }

  const allContributions = [
    ...manifest.connectors,
    ...manifest.tools,
    ...manifest.artifacts,
    ...manifest.agents,
    ...manifest.skills,
  ];
  const componentIds = allContributions.map((contribution) => contribution.componentId);
  if (new Set(componentIds).size !== componentIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["connectors"],
      message: "Plugin contribution componentIds must be globally unique inside the plugin.",
    });
  }
  const contributionIds = allContributions.map((contribution) => contribution.id);
  if (new Set(contributionIds).size !== contributionIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["connectors"],
      message: "Plugin contribution ids must be globally unique inside the plugin.",
    });
  }

  for (const [index, artifact] of manifest.artifacts.entries()) {
    if (new Set(artifact.artifactKinds).size !== artifact.artifactKinds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts", index, "artifactKinds"],
        message: "Artifact kinds must be unique inside a plugin artifact contribution.",
      });
    }
  }
});
export type LiosPluginManifestV1 = z.infer<typeof liosPluginManifestV1Schema>;

const PRIVILEGED_PERMISSIONS = new Set<PluginPermission>([
  "project.write",
  "artifact.write",
  "connector.credentials",
  "ai.invoke",
  "network.http",
  "filesystem.project.read",
  "filesystem.project.write",
  "filesystem.user_selected.read",
  "filesystem.user_selected.write",
  "process.spawn",
]);

export function isPrivilegedPluginPermission(permission: PluginPermission): boolean {
  return PRIVILEGED_PERMISSIONS.has(permission);
}

export function hasPrivilegedPluginPermissions(manifest: LiosPluginManifestV1): boolean {
  return manifest.permissions.some(isPrivilegedPluginPermission);
}

function compareVersionStrings(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(objectValue).sort().map((key) => [key, stableValue(objectValue[key])]),
    );
  }
  return value;
}

export function canonicalPluginPayload(input: LiosPluginManifestV1): string {
  const manifest = liosPluginManifestV1Schema.parse(input);
  const payload = { ...manifest } as Record<string, unknown>;
  delete payload.integrity;
  delete payload.signer;
  // Manifests signed before skills existed must keep verifying: an empty list is not part of the signed form.
  if (manifest.skills.length === 0) delete payload.skills;
  return JSON.stringify(stableValue(payload));
}

export interface PluginManifestPackageInput {
  manifest: unknown;
  observedPackageDigest?: string | null;
}

export interface PluginManifestPackage {
  manifest: LiosPluginManifestV1;
  observedPackageDigest: string | null;
}

export interface PluginSdkPackageInput extends PluginManifestPackageInput {
  connectors?: ConnectorAdapter[];
  tools?: ToolAdapter[];
  artifacts?: ArtifactRendererAdapter[];
  agents?: AgentAdapter[];
}

export interface PluginSdkPackage extends PluginManifestPackage {
  manifest: LiosPluginManifestV1;
  observedPackageDigest: string | null;
  connectors: ConnectorAdapter[];
  tools: ToolAdapter[];
  artifacts: ArtifactRendererAdapter[];
  agents: AgentAdapter[];
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function validateAdapterSet(
  label: "connectors" | "tools" | "artifacts" | "agents",
  expectedKind: RuntimeComponentKind,
  contributions: PluginContribution[],
  adapters: RuntimeAdapter[],
  declaredPermissions: PluginPermission[],
): void {
  const expectedIds = contributions.map((item) => item.componentId);
  const actualIds = adapters.map((adapter) => adapter.descriptor.id);

  if (!sameStrings(expectedIds, actualIds)) {
    throw new Error("Plugin " + label + " do not match the manifest componentIds.");
  }

  const contributionsByComponentId = new Map(
    contributions.map((contribution) => [contribution.componentId, contribution] as const),
  );
  const permissionSet = new Set<string>(declaredPermissions);

  for (const adapter of adapters) {
    if (adapter.descriptor.kind !== expectedKind) {
      throw new Error(
        "Plugin adapter " + adapter.descriptor.id + " must be runtime kind " + expectedKind + ".",
      );
    }
    if (adapter.descriptor.lifecycle !== "external") {
      throw new Error("Plugin adapter " + adapter.descriptor.id + " must use external lifecycle.");
    }
    if (adapter.descriptor.source.origin !== "external") {
      throw new Error("Plugin adapter " + adapter.descriptor.id + " must use external source origin.");
    }

    const contribution = contributionsByComponentId.get(adapter.descriptor.id);
    if (!contribution || !sameStrings(contribution.capabilities, adapter.descriptor.capabilities)) {
      throw new Error("Plugin adapter " + adapter.descriptor.id + " capabilities differ from its manifest contribution.");
    }

    const undeclaredPermissions = adapter.descriptor.permissions.filter((permission) => !permissionSet.has(permission));
    if (undeclaredPermissions.length > 0) {
      throw new Error(
        "Plugin adapter " + adapter.descriptor.id + " requests undeclared permissions: "
        + undeclaredPermissions.join(","),
      );
    }
  }
}

export function defineConnector(adapter: ConnectorAdapter): ConnectorAdapter {
  if (adapter.descriptor.kind !== "connector") throw new Error("Connector SDK requires a connector descriptor.");
  return adapter;
}

export function defineTool(adapter: ToolAdapter): ToolAdapter {
  if (adapter.descriptor.kind !== "tool") throw new Error("Tool SDK requires a tool descriptor.");
  return adapter;
}

export function defineArtifact(adapter: ArtifactRendererAdapter): ArtifactRendererAdapter {
  if (adapter.descriptor.kind !== "artifact_renderer") {
    throw new Error("Artifact SDK requires an artifact_renderer descriptor.");
  }
  return adapter;
}

export function defineAgent(adapter: AgentAdapter): AgentAdapter {
  if (adapter.descriptor.kind !== "agent") throw new Error("Agent SDK requires an agent descriptor.");
  return adapter;
}

export function definePluginPackageManifest(input: PluginManifestPackageInput): PluginManifestPackage {
  const manifest = liosPluginManifestV1Schema.parse(input.manifest);
  const observedPackageDigest = input.observedPackageDigest ?? null;
  if (observedPackageDigest && !sha256Schema.safeParse(observedPackageDigest).success) {
    throw new Error("Observed plugin package digest must be sha256 hex.");
  }
  if (observedPackageDigest && !manifest.integrity) {
    throw new Error("Observed plugin package digest requires signed integrity metadata.");
  }
  if (manifest.integrity && observedPackageDigest && manifest.integrity.digest !== observedPackageDigest) {
    throw new Error("Observed plugin package digest does not match the signed manifest.");
  }
  return { manifest, observedPackageDigest };
}

export function definePlugin(input: PluginSdkPackageInput): PluginSdkPackage {
  const packageManifest = definePluginPackageManifest(input);
  const manifest = packageManifest.manifest;
  const observedPackageDigest = packageManifest.observedPackageDigest;

  const plugin: PluginSdkPackage = {
    manifest,
    observedPackageDigest,
    connectors: (input.connectors ?? []).map(defineConnector),
    tools: (input.tools ?? []).map(defineTool),
    artifacts: (input.artifacts ?? []).map(defineArtifact),
    agents: (input.agents ?? []).map(defineAgent),
  };

  validateAdapterSet("connectors", "connector", manifest.connectors, plugin.connectors, manifest.permissions);
  validateAdapterSet("tools", "tool", manifest.tools, plugin.tools, manifest.permissions);
  validateAdapterSet("artifacts", "artifact_renderer", manifest.artifacts, plugin.artifacts, manifest.permissions);
  validateAdapterSet("agents", "agent", manifest.agents, plugin.agents, manifest.permissions);

  return plugin;
}
