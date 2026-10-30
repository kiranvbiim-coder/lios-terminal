import crypto from "node:crypto";
import {
  LOCAL_EXTENSION_MAX_BYTES, localExtensionInputSchema, extensionConsentSchema, extensionPublisherConsentSchema,
  type ExtensionCatalog, type ExtensionPreview, type LocalExtensionInput,
} from "@shared/p13ExtensionContracts";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import type { P13PluginRuntimeHost } from "./p13PluginRuntime";
import type { P11PackManager } from "./p11PackManager";
import { PluginTrustStore, computePluginPackageDigest, signPluginManifest } from "./p13PluginTrust";
import { skillDocumentManifest } from "./skillDocument";

export interface ExtensionPrincipal {
  userId: number;
  role: string;
  organizationId: number | null;
  active: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  homeOwner: boolean;
}
export class ExtensionAdmissionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
interface PendingPackage {
  ownerId: number;
  input: LocalExtensionInput;
  bytes: Buffer;
  preview: ExtensionPreview;
}
const PREVIEW_TTL_MS = 10 * 60 * 1000;

/** Review custody only: installations and adapters remain owned by P13/P11. No vendor catalog or downloader. */
export class P13ExtensionService {
  private readonly pending = new Map<string, PendingPackage>();
  constructor(private readonly host: P13PluginRuntimeHost, private readonly packs: P11PackManager | null, private readonly clock: () => number = Date.now,
    private readonly skillTools: () => NonNullable<ExtensionCatalog["skillTools"]> = () => []) {}

  private admit(actor: ExtensionPrincipal): void {
    if (!actor.homeOwner || actor.role !== "internal_admin" || actor.organizationId !== null || !actor.active || actor.mustChangePassword || (actor.lockedUntil && actor.lockedUntil.getTime() > this.clock())) {
      throw new ExtensionAdmissionError(403, "Only the current unlocked Home owner administrator can manage global extensions.");
    }
  }

  catalog(actor: ExtensionPrincipal): ExtensionCatalog {
    this.admit(actor);
    return { managementAllowed: true, sessionOnly: true, plugins: this.host.plugins.list(), packs: this.packs?.discover() ?? [], packImportAvailable: this.packs !== null, skillTools: this.skillTools() };
  }

  private assess(input: LocalExtensionInput, bytes: Buffer, previewId: string, expiresAt: string, ownerId: number): ExtensionPreview {
    const packageDigest = computePluginPackageDigest(bytes);
    let details: Omit<ExtensionPreview, "previewId" | "reviewHash" | "packageDigest" | "byteLength" | "expiresAt">;
    if (input.kind === "skill_document") {
      const { manifest, warnings, findings } = skillDocumentManifest(input.document, ownerId, input.toolIds, new Date(Date.parse(expiresAt) - PREVIEW_TTL_MS).toISOString());
      const allowedTools = new Set(this.skillTools().map(tool => tool.id));
      const reasons: string[] = findings.filter(finding => finding.severity === "critical")
        .map(finding => `Critical finding ${finding.ruleId} at line ${finding.line}; remove it before adopting this document.`);
      if (input.toolIds.some(id => !allowedTools.has(id))) reasons.push("A selected tool is unavailable in the current canonical governed registry.");
      if (this.host.plugins.get(manifest.id)) reasons.push("This exact owner-adopted document is already installed.");
      if (this.host.trustStore.isDigestRevoked(packageDigest)) reasons.push("This document digest has been revoked.");
      const instructionCharacters = this.host.plugins.list().reduce((sum, plugin) => sum + plugin.manifest.skills.reduce((n, skill) => n + (skill.instructions?.length ?? 0), 0), 0);
      if (instructionCharacters + manifest.skills[0].instructions!.length > 64_000) reasons.push("Installed skill procedures exceed the 64000-character Home instruction budget; revoke unused procedures first.");
      details = {
        kind: "p13", manifest, manifestDigest: crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
        publisherKeyId: null, publisherFingerprint: null, trust: "owner_review_required",
        reasons, installable: reasons.length === 0, activation: "declarative",
        ownerAdoption: { document: input.document, toolIds: input.toolIds, warnings, originalPublisherVerified: false },
      };
    } else if (input.kind === "p13") {
      const assessment = this.host.plugins.preview({ manifest: input.manifest, observedPackageDigest: packageDigest });
      const manifest = assessment.manifest;
      const reasons = [...assessment.reasons];
      if (assessment.trust.state !== "trusted") reasons.push("A signed manifest and explicitly trusted publisher are required for local import.");
      if (manifest.runtime.kind !== "declarative") reasons.push("Executable activation is unavailable here: a supervised isolated broker and exact execution grant must be provisioned separately.");
      if (manifest.artifacts.length + manifest.skills.length === 0) reasons.push("No supported declarative contributions are present.");
      details = {
        kind: "p13", manifest, manifestDigest: assessment.trust.manifestDigest,
        publisherKeyId: manifest.signer?.keyId ?? null,
        publisherFingerprint: manifest.signer ? this.host.trustStore.fingerprint(manifest.signer.keyId) : null,
        trust: assessment.trust.state, reasons: [...new Set(reasons)], installable: reasons.length === 0,
        activation: manifest.runtime.kind === "declarative" ? "declarative" : "unavailable",
      };
    } else {
      if (!this.packs) throw new ExtensionAdmissionError(409, "P11 local pack manager is unavailable on this target.");
      const verification = this.packs.preview({ archive: bytes });
      details = {
        kind: "p11", manifest: verification.manifest, manifestDigest: verification.manifestDigest,
        publisherKeyId: verification.manifest?.publisher.keyId ?? null, publisherFingerprint: verification.manifest ? this.packs.publisherFingerprint(verification.manifest.publisher.keyId) : null,
        trust: verification.ok ? "trusted" : "unverified", reasons: verification.errors,
        installable: verification.ok && !this.packs.inspect(verification.manifest!.id)?.versions.some(row => row.version === verification.manifest!.version),
        activation: "inactive_only",
      };
      if (verification.ok && !details.installable) details.reasons.push("This exact pack version is already installed.");
    }
    const review = { previewId, packageDigest, byteLength: bytes.length, expiresAt, ...details };
    const reviewHash = crypto.createHash("sha256").update(JSON.stringify({ review, installed: this.host.plugins.list().map(row => ({ id: row.id, version: row.version, digest: row.trust.digest })), packs: this.packs?.discover() ?? [] })).digest("hex");
    return { ...review, reviewHash };
  }

  preview(actor: ExtensionPrincipal, raw: unknown): ExtensionPreview {
    this.admit(actor);
    const input = localExtensionInputSchema.parse(raw);
    const bytes = input.kind === "skill_document" ? Buffer.from(input.document, "utf8") : Buffer.from(input.kind === "p13" ? input.payloadBase64 : input.archiveBase64, "base64");
    if (bytes.length === 0 || bytes.length > LOCAL_EXTENSION_MAX_BYTES ||
      (input.kind !== "skill_document" && bytes.toString("base64") !== (input.kind === "p13" ? input.payloadBase64 : input.archiveBase64))) {
      throw new ExtensionAdmissionError(400, "Supply exact document text or canonical base64 package bytes, at most 8 MiB.");
    }
    if (input.kind === "p13") input.manifest = liosPluginManifestV1Schema.parse(input.manifest);
    for (const [id, item] of this.pending) if (Date.parse(item.preview.expiresAt) <= this.clock()) this.pending.delete(id);
    if (this.pending.size >= 16) throw new ExtensionAdmissionError(429, "Too many pending local package reviews. Cancel a review or let it expire.");
    const preview = this.assess(input, bytes, crypto.randomUUID(), new Date(this.clock() + PREVIEW_TTL_MS).toISOString(), actor.userId);
    this.pending.set(preview.previewId, { ownerId: actor.userId, input, bytes, preview });
    return structuredClone(preview);
  }

  private reviewed(actor: ExtensionPrincipal, previewId: string, reviewHash: string): PendingPackage {
    this.admit(actor);
    const item = this.pending.get(previewId);
    if (!item || item.ownerId !== actor.userId) throw new ExtensionAdmissionError(404, "Local package review not found for this owner.");
    if (Date.parse(item.preview.expiresAt) <= this.clock()) {
      this.pending.delete(previewId);
      throw new ExtensionAdmissionError(409, "Package review expired; import and inspect the bytes again.");
    }
    const current = this.assess(item.input, item.bytes, previewId, item.preview.expiresAt, actor.userId);
    if (reviewHash !== item.preview.reviewHash || current.reviewHash !== reviewHash) throw new ExtensionAdmissionError(409, "Package trust, compatibility or runtime state changed; import and review again.");
    return item;
  }

  trustPublisher(actor: ExtensionPrincipal, raw: unknown): ExtensionPreview {
    const consent = extensionPublisherConsentSchema.parse(raw);
    const item = this.reviewed(actor, consent.previewId, consent.reviewHash);
    const key = crypto.createPublicKey(consent.publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new ExtensionAdmissionError(400, "Publisher public key must be Ed25519.");
    const fingerprint = crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
    if (fingerprint !== consent.fingerprint) throw new ExtensionAdmissionError(409, "Publisher key fingerprint differs from the reviewed key.");
    const keyId = item.preview.publisherKeyId;
    if (!keyId) throw new ExtensionAdmissionError(409, "Package has no signed publisher key identity.");
    if (item.input.kind === "skill_document") throw new ExtensionAdmissionError(409, "Owner adoption cannot claim original publisher trust.");
    if (item.input.kind === "p13") {
      const manifest = liosPluginManifestV1Schema.parse(item.input.manifest);
      const verifier = new PluginTrustStore();
      verifier.trustKey(keyId, key);
      if (verifier.verify(manifest, item.preview.packageDigest).state !== "trusted") throw new ExtensionAdmissionError(409, "The supplied key does not verify the exact signed manifest and package bytes.");
      // Refuse resurrection of a revoked digest/key, even when its signature still verifies.
      if (this.host.trustStore.verify(manifest, item.preview.packageDigest).state === "revoked") throw new ExtensionAdmissionError(409, "Publisher or package has been revoked.");
      this.host.trustStore.trustKey(keyId, key);
    } else {
      const verified = this.packs!.previewPublisher({ archive: item.bytes }, keyId, key);
      if (!verified.ok) throw new ExtensionAdmissionError(409, "Publisher/package verification failed: " + verified.errors.join(" "));
      this.packs!.trustPublisher(keyId, key);
    }
    item.preview = this.assess(item.input, item.bytes, item.preview.previewId, item.preview.expiresAt, actor.userId);
    return structuredClone(item.preview);
  }

  install(actor: ExtensionPrincipal, raw: unknown) {
    const consent = extensionConsentSchema.parse(raw);
    const item = this.reviewed(actor, consent.previewId, consent.reviewHash);
    if (consent.packageDigest !== item.preview.packageDigest) throw new ExtensionAdmissionError(409, "Consent does not identify the reviewed package bytes.");
    if (!item.preview.installable) throw new ExtensionAdmissionError(409, "Package is unavailable: " + item.preview.reasons.join(" "));
    this.pending.delete(consent.previewId);
    if (item.input.kind === "skill_document") {
      const manifest = liosPluginManifestV1Schema.parse(item.preview.manifest);
      const pair = crypto.generateKeyPairSync("ed25519");
      const keyId = "lios.home-owner-adoption." + crypto.randomUUID();
      // Local signing attests only this explicit owner adoption, never the upstream publisher.
      const signed = signPluginManifest(manifest, keyId, pair.privateKey, item.preview.packageDigest);
      this.host.trustStore.trustKey(keyId, pair.publicKey);
      try {
        return { kind: "p13" as const, installed: this.host.installDeclarativePlugin({ manifest: signed, observedPackageDigest: item.preview.packageDigest }), sessionOnly: true };
      } catch (error) {
        this.host.trustStore.revokeKey(keyId);
        throw error;
      }
    }
    if (item.input.kind === "p13") {
      return { kind: "p13" as const, installed: this.host.installDeclarativePlugin({ manifest: item.input.manifest, observedPackageDigest: computePluginPackageDigest(item.bytes) }), sessionOnly: true };
    }
    return { kind: "p11" as const, installed: this.packs!.install({ archive: item.bytes }), activation: "inactive_only" as const };
  }

  inspect(actor: ExtensionPrincipal, kind: string, id: string, version?: string) {
    this.admit(actor);
    if (kind === "p13") {
      const plugin = this.host.plugins.get(id);
      if (!plugin) throw new ExtensionAdmissionError(404, "Installed plugin not found.");
      return { kind, plugin, currentTrust: this.host.trustStore.verify(plugin.manifest, plugin.trust.packageDigest), contributions: plugin.componentIds.map(componentId => this.host.registry.get(componentId)?.descriptor ?? null) };
    }
    if (kind !== "p11" || !version || !this.packs?.inspect(id)?.versions.some(row => row.version === version)) throw new ExtensionAdmissionError(404, "Installed pack version not found.");
    const verification = this.packs.inspectManifest(id, version);
    return { kind, state: this.packs.inspect(id), manifest: verification.manifest, verified: verification.ok, reasons: verification.errors, activation: "inactive_only" };
  }

  revoke(actor: ExtensionPrincipal, kind: string, id: string, digest: string, version?: string) {
    this.admit(actor);
    if (kind === "p13") {
      const current = this.host.plugins.get(id);
      if (!current || current.trust.packageDigest !== digest) throw new ExtensionAdmissionError(409, "Installed package changed; inspect before revoking.");
      return { revoked: this.host.plugins.revoke(id) };
    }
    // Never alter another authority's active executable pack or pretend an adapter was stopped.
    if (kind !== "p11" || !version || !this.packs) throw new ExtensionAdmissionError(404, "Installed pack not found.");
    const current = this.packs.inspect(id);
    if (!current || current.activeVersion === version) throw new ExtensionAdmissionError(409, "Active executable packs must be stopped by their supervised runtime before removal.");
    const verified = this.packs.inspectManifest(id, version);
    if (verified.manifestDigest !== digest) throw new ExtensionAdmissionError(409, "Installed pack changed; inspect before removal.");
    return { removed: this.packs.remove(id, version) };
  }

  cancel(actor: ExtensionPrincipal, previewId: string): void {
    this.admit(actor);
    if (this.pending.get(previewId)?.ownerId === actor.userId) this.pending.delete(previewId);
  }
}
