import { z } from "zod";

export const runtimeLifecycleRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("install"), releasePackIds: z.array(z.enum(["core", "research", "quant", "modeling", "data-lab", "local-ai"])).min(1).max(6), additionalPackIds: z.array(z.enum(["community-yahoo"])).max(1).default([]) }).strict(),
  z.object({ operation: z.literal("lazy_install"), capability: z.string().trim().min(1).max(100) }).strict(),
  z.object({ operation: z.literal("repair") }).strict(),
  z.object({ operation: z.literal("upgrade") }).strict(),
  z.object({ operation: z.literal("rollback") }).strict(),
]);
export type RuntimeLifecycleRequest = z.infer<typeof runtimeLifecycleRequestSchema>;

export interface RuntimeLifecyclePreview {
  request: RuntimeLifecycleRequest;
  operationHash: string;
  confirmationToken: string;
  expiresAt: number;
  sourceStateHash: string;
  custodyHash: string;
  targetManifestHash: string;
  targetManifestVersion: string;
  targetPackIds: string[];
  selectedReleasePackIds: string[];
  releaseLocks: Array<{ packId: string; sha256: string | null }>;
  rollbackAvailable: boolean;
  blockers: string[];
  summary: string;
}
