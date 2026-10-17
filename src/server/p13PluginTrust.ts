import crypto from "node:crypto";
import {
  canonicalPluginPayload,
  liosPluginManifestV1Schema,
  type LiosPluginManifestV1,
} from "@shared/pluginSdk";

export type PluginTrustState =
  | "trusted"
  | "unsigned"
  | "unknown_signer"
  | "invalid"
  | "revoked";

export interface PluginTrustDecision {
  state: PluginTrustState;
  digest: string;
  manifestDigest: string;
  packageDigest: string | null;
  reason: string;
  keyId: string | null;
}

interface TrustKeyRecord {
  publicKey: crypto.KeyObject;
  revoked: boolean;
}

export function computePluginDigest(input: LiosPluginManifestV1): string {
  return crypto.createHash("sha256").update(canonicalPluginPayload(input)).digest("hex");
}

export function computePluginPackageDigest(payload: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function signaturePayload(input: LiosPluginManifestV1): string {
  if (!input.integrity) throw new Error("Signed plugin manifest requires package integrity.");
  return computePluginDigest(input) + ":" + input.integrity.digest;
}

export function signPluginManifest(
  input: LiosPluginManifestV1,
  keyId: string,
  privateKey: crypto.KeyObject,
  packageDigest: string,
): LiosPluginManifestV1 {
  const base = liosPluginManifestV1Schema.parse({
    ...input,
    integrity: null,
    signer: null,
  });
  const resolvedPackageDigest = packageDigest;
  if (!/^[a-f0-9]{64}$/.test(resolvedPackageDigest)) {
    throw new Error("Plugin package digest must be sha256 hex.");
  }

  const candidate = liosPluginManifestV1Schema.parse({
    ...base,
    integrity: { algorithm: "sha256", digest: resolvedPackageDigest },
    signer: {
      algorithm: "ed25519",
      keyId,
      signature: "placeholder-signature-placeholder-signature",
    },
  });
  const signature = crypto.sign(
    null,
    Buffer.from(signaturePayload(candidate), "utf8"),
    privateKey,
  ).toString("base64");

  return liosPluginManifestV1Schema.parse({
    ...base,
    integrity: { algorithm: "sha256", digest: resolvedPackageDigest },
    signer: { algorithm: "ed25519", keyId, signature },
  });
}

export class PluginTrustStore {
  private readonly keys = new Map<string, TrustKeyRecord>();
  private readonly revokedDigests = new Set<string>();

  trustKey(keyId: string, publicKey: crypto.KeyObject): void {
    if (!keyId.trim()) throw new Error("Plugin trust key id is required.");
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Plugin publisher keys must use Ed25519.");
    const existing = this.keys.get(keyId);
    if (existing && (existing.revoked || this.fingerprint(keyId) !== this.keyFingerprint(publicKey))) {
      throw new Error("Publisher key id is already bound or revoked; use a new publisher key id.");
    }
    this.keys.set(keyId, { publicKey, revoked: false });
  }

  private keyFingerprint(publicKey: crypto.KeyObject): string {
    return crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  }

  fingerprint(keyId: string): string | null {
    const key = this.keys.get(keyId);
    return key ? this.keyFingerprint(key.publicKey) : null;
  }

  revokeKey(keyId: string): void {
    const record = this.keys.get(keyId);
    if (!record) throw new Error("Plugin trust key is not registered.");
    record.revoked = true;
  }

  revokeDigest(digest: string): void {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Plugin digest must be sha256 hex.");
    this.revokedDigests.add(digest);
  }

  verify(
    input: LiosPluginManifestV1,
    observedPackageDigest: string | null = null,
  ): PluginTrustDecision {
    const manifest = liosPluginManifestV1Schema.parse(input);
    const manifestDigest = computePluginDigest(manifest);
    const packageDigest = manifest.integrity?.digest ?? null;
    const base = {
      digest: packageDigest ?? manifestDigest,
      manifestDigest,
      packageDigest,
      keyId: manifest.signer?.keyId ?? null,
    };

    if (packageDigest && this.revokedDigests.has(packageDigest)) {
      return { ...base, state: "revoked", reason: "plugin_package_digest_revoked" };
    }

    if (!manifest.integrity || !manifest.signer) {
      return { ...base, state: "unsigned", reason: "plugin_unsigned" };
    }

    if (!observedPackageDigest) {
      return { ...base, state: "invalid", reason: "package_digest_unobserved" };
    }
    if (observedPackageDigest !== packageDigest) {
      return { ...base, state: "invalid", reason: "package_digest_mismatch" };
    }

    const record = this.keys.get(manifest.signer.keyId);
    if (!record) {
      return { ...base, state: "unknown_signer", reason: "signing_key_unknown" };
    }
    if (record.revoked) {
      return { ...base, state: "revoked", reason: "signing_key_revoked" };
    }

    let valid = false;
    try {
      valid = crypto.verify(
        null,
        Buffer.from(signaturePayload(manifest), "utf8"),
        record.publicKey,
        Buffer.from(manifest.signer.signature, "base64"),
      );
    } catch {
      valid = false;
    }

    return valid
      ? { ...base, state: "trusted", reason: "signature_and_package_digest_verified" }
      : { ...base, state: "invalid", reason: "signature_invalid" };
  }
}
