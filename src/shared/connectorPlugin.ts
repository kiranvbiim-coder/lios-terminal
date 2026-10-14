import { z } from "zod";
import type { ConnectorDefinition } from "./connectorRegistry";

const capabilitySchema = z.object({
  contractFamily: z.string().trim().min(1).max(120),
  fields: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
  coverage: z.string().trim().max(500).optional(),
});

export const connectorPluginManifestSchema = z.object({
  apiVersion: z.literal("1"),
  id: z.string().trim().regex(/^custom_[a-z0-9][a-z0-9_-]{1,63}$/),
  version: z.string().trim().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  category: z.enum(["market", "fundamentals", "macro", "filings", "research", "platform", "ai", "private_data", "operations", "crypto"]),
  sourceType: z.enum(["public_api", "keyed_api", "file", "database", "private_api", "cloud_storage", "sidecar", "local_model"]),
  authMode: z.enum(["none", "api_key", "bearer", "basic", "oauth", "database_credentials", "local"]),
  custodyMode: z.enum(["public", "user_licensed", "local_only", "client_private"]),
  capabilities: z.array(capabilitySchema).min(1).max(100),
  setupGuide: z.string().trim().min(1).max(2000),
  rateLimits: z.string().trim().max(500).optional(),
  licenseNotes: z.string().trim().max(1000).optional(),
  websiteUrl: z.string().url().optional(),
  freeTier: z.boolean().optional(),
  executable: z.literal(false).default(false),
});

export type ConnectorPluginManifest = z.infer<typeof connectorPluginManifestSchema>;

export function parseConnectorPluginManifest(input: unknown): ConnectorDefinition | null {
  const parsed = connectorPluginManifestSchema.safeParse(input);
  if (!parsed.success) return null;
  return { ...parsed.data, builtIn: false, adapterImplemented: false };
}

export function validateConnectorPluginManifest(input: unknown): { valid: true; definition: ConnectorDefinition } | { valid: false; errors: string[] } {
  const parsed = connectorPluginManifestSchema.safeParse(input);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map(issue => `${issue.path.join(".") || "manifest"}: ${issue.message}`) };
  return { valid: true, definition: { ...parsed.data, builtIn: false, adapterImplemented: false } };
}
