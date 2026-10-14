import { z } from "zod";

export const LIOS_HIDDEN_ENGINE_PACK_MANIFEST_VERSION = "1" as const;

const packIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, "Pack ids must be lowercase and separator-safe.");

const capabilityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/, "Capability ids must be lowercase and separator-safe.");

const semverSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    "Expected a semantic version such as 1.2.3.",
  );

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest.");

export const hiddenEnginePackPlatformSchema = z.enum([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
]);
export type HiddenEnginePackPlatform = z.infer<typeof hiddenEnginePackPlatformSchema>;

export const hiddenEnginePackRuntimeKindSchema = z.enum([
  "python",
  "node",
  "native",
  "jvm",
  "dotnet",
  "wasm",
]);
export type HiddenEnginePackRuntimeKind = z.infer<typeof hiddenEnginePackRuntimeKindSchema>;

export const hiddenEnginePackDataPlaneSchema = z.enum([
  "json",
  "arrow-ipc",
  "parquet",
  "duckdb-relation",
]);
export type HiddenEnginePackDataPlane = z.infer<typeof hiddenEnginePackDataPlaneSchema>;

export const hiddenEnginePackPermissionSchema = z
  .object({
    network: z
      .object({
        allowed: z.boolean().default(false),
        allowedHosts: z.array(z.string().trim().min(1).max(253)).max(100).default([]),
      })
      .strict()
      .default({ allowed: false, allowedHosts: [] }),
    filesystem: z
      .object({
        mode: z.enum(["none", "scoped_temp", "project_scoped", "user_selected"]).default("none"),
        roots: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
      })
      .strict()
      .default({ mode: "none", roots: [] }),
    secretHandles: z.array(capabilityIdSchema).max(100).default([]),
    processSpawn: z.boolean().default(false),
    gpu: z.boolean().default(false),
    externalSideEffects: z.boolean().default(false),
    brokerWrite: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.network.allowed && value.network.allowedHosts.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["network", "allowedHosts"],
        message: "Network hosts cannot be allow-listed when network access is disabled.",
      });
    }
    if (value.filesystem.mode === "none" && value.filesystem.roots.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filesystem", "roots"],
        message: "Filesystem roots require an enabled filesystem mode.",
      });
    }
    if (value.brokerWrite && !value.externalSideEffects) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["brokerWrite"],
        message: "Broker/write permission implies external side effects.",
      });
    }
    if (new Set(value.network.allowedHosts).size !== value.network.allowedHosts.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["network", "allowedHosts"],
        message: "Allowed network hosts must be unique.",
      });
    }
    if (new Set(value.filesystem.roots).size !== value.filesystem.roots.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filesystem", "roots"],
        message: "Filesystem roots must be unique.",
      });
    }
    if (new Set(value.secretHandles).size !== value.secretHandles.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secretHandles"],
        message: "Secret handles must be unique.",
      });
    }
  });
export type HiddenEnginePackPermission = z.infer<typeof hiddenEnginePackPermissionSchema>;

export const hiddenEnginePackResourceBudgetSchema = z
  .object({
    memorySoftMb: z.number().int().positive(),
    memoryHardMb: z.number().int().positive(),
    cpuMaxCores: z.number().positive(),
    maxConcurrency: z.number().int().positive(),
    maxWorkers: z.number().int().positive(),
    defaultTimeoutSec: z.number().int().positive(),
    maxTimeoutSec: z.number().int().positive(),
    maxDatasetMb: z.number().int().positive(),
    idleShutdownSec: z.number().int().positive().nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.memoryHardMb < value.memorySoftMb) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memoryHardMb"],
        message: "memoryHardMb must be greater than or equal to memorySoftMb.",
      });
    }
    if (value.maxTimeoutSec < value.defaultTimeoutSec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxTimeoutSec"],
        message: "maxTimeoutSec must be greater than or equal to defaultTimeoutSec.",
      });
    }
    if (value.maxWorkers > value.maxConcurrency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxWorkers"],
        message: "maxWorkers cannot exceed maxConcurrency.",
      });
    }
  });
export type HiddenEnginePackResourceBudget = z.infer<typeof hiddenEnginePackResourceBudgetSchema>;

export const hiddenEnginePackManifestV1Schema = z
  .object({
    schemaVersion: z.literal(LIOS_HIDDEN_ENGINE_PACK_MANIFEST_VERSION),
    id: packIdSchema,
    version: semverSchema,
    displayName: z.string().trim().min(1).max(160),
    visibility: z.literal("internal"),
    publisher: z
      .object({
        id: packIdSchema,
        keyId: z.string().trim().min(1).max(200),
      })
      .strict(),
    liosCore: z
      .object({
        min: semverSchema,
        maxExclusive: semverSchema,
      })
      .strict(),
    platforms: z.array(hiddenEnginePackPlatformSchema).min(1).max(12),
    runtime: z
      .object({
        kind: hiddenEnginePackRuntimeKindSchema,
        version: z.string().trim().min(1).max(100).nullable().default(null),
        entrypoint: z.string().trim().min(1).max(1_000),
        isolation: z.enum(["in_process", "worker", "process"]),
      })
      .strict(),
    capabilities: z.array(capabilityIdSchema).min(1).max(1_000),
    permissions: hiddenEnginePackPermissionSchema,
    resources: hiddenEnginePackResourceBudgetSchema,
    dataPlane: z.array(hiddenEnginePackDataPlaneSchema).min(1).max(4),
    licenses: z
      .object({
        sbom: z.string().trim().min(1).max(1_000),
        notices: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    integrity: z
      .object({
        manifestSha256: sha256Schema,
        payloadSha256: sha256Schema,
        signature: z
          .object({
            algorithm: z.literal("ed25519"),
            keyId: z.string().trim().min(1).max(200),
            value: z.string().trim().min(32).max(1_024),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.platforms).size !== value.platforms.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platforms"],
        message: "Pack platforms must be unique.",
      });
    }
    if (new Set(value.capabilities).size !== value.capabilities.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities"],
        message: "Pack capabilities must be unique.",
      });
    }
    if (new Set(value.dataPlane).size !== value.dataPlane.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataPlane"],
        message: "Pack data-plane formats must be unique.",
      });
    }
    if (value.runtime.isolation === "in_process" && value.runtime.kind !== "node" && value.runtime.kind !== "wasm") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtime", "isolation"],
        message: "Only Node or WASM packs may declare in-process isolation in manifest v1.",
      });
    }
  });

export type HiddenEnginePackManifestV1 = z.infer<typeof hiddenEnginePackManifestV1Schema>;

export function parseHiddenEnginePackManifestV1(value: unknown): HiddenEnginePackManifestV1 {
  return hiddenEnginePackManifestV1Schema.parse(value);
}
