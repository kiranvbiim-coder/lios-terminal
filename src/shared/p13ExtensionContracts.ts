import { z } from "zod";
import type { LiosPluginManifestV1 } from "./pluginSdk";
import type { HiddenEnginePackManifestV1 } from "./hiddenEnginePackManifest";

export const LOCAL_EXTENSION_MAX_BYTES = 8 * 1024 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const localExtensionInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("p13"), manifest: z.unknown(), payloadBase64: z.string().min(4).max(12 * 1024 * 1024) }).strict(),
  z.object({ kind: z.literal("p11"), archiveBase64: z.string().min(4).max(12 * 1024 * 1024) }).strict(),
]);
export type LocalExtensionInput = z.infer<typeof localExtensionInputSchema>;
export const extensionConsentSchema = z.object({
  previewId: z.string().uuid(), reviewHash: digest, packageDigest: digest,
  consent: z.literal(true), rightsConfirmed: z.literal(true),
}).strict();
export type ExtensionConsent = z.infer<typeof extensionConsentSchema>;
export const extensionPublisherConsentSchema = z.object({
  previewId: z.string().uuid(), reviewHash: digest, publicKeyPem: z.string().min(32).max(4096),
  fingerprint: digest, trustPublisher: z.literal(true),
}).strict();
export type ExtensionPublisherConsent = z.infer<typeof extensionPublisherConsentSchema>;
export interface ExtensionPreview {
  previewId: string;
  reviewHash: string;
  packageDigest: string;
  byteLength: number;
  expiresAt: string;
  kind: "p13" | "p11";
  manifest: LiosPluginManifestV1 | HiddenEnginePackManifestV1 | null;
  manifestDigest: string;
  publisherKeyId: string | null;
  publisherFingerprint: string | null;
  trust: string;
  reasons: string[];
  installable: boolean;
  activation: "declarative" | "inactive_only" | "unavailable";
}
export interface ExtensionCatalog {
  managementAllowed: boolean;
  sessionOnly: true;
  plugins: Array<{ id: string; version: string; manifest: LiosPluginManifestV1; componentIds: string[]; trust: { state: string; reason: string; packageDigest: string | null; manifestDigest: string; keyId: string | null } }>;
  packs: Array<{ packId: string; activeVersion: string | null; versions: Array<{ version: string; state: string; lastHealth: string }> }>;
  packImportAvailable: boolean;
}
