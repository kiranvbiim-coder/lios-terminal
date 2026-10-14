import crypto from "node:crypto";
import type { ModelAssuranceArtifact, UnsignedModelAssuranceArtifact } from "@shared/modelAssurance";
import { modelAssuranceArtifactSchema, unsignedModelAssuranceArtifactSchema } from "@shared/modelAssurance";
import { stableJson } from "./modelValidationHarness";

export const ASSURANCE_SIGNATURE_ALGORITHM = "ed25519" as const;
export const ASSURANCE_PUBLIC_KEY_ENV = "LIOS_ASSURANCE_PUBLIC_KEY";
export const ASSURANCE_PRIVATE_KEY_ENV = "LIOS_ASSURANCE_PRIVATE_KEY";

export interface AssuranceSignatureVerification {
  valid: boolean;
  keyId: string | null;
  reason: string | null;
}

function normalizePem(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function publicKeyId(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
}

export function assurancePayload(artifact: UnsignedModelAssuranceArtifact): string {
  const parsed = unsignedModelAssuranceArtifactSchema.parse(artifact);
  return stableJson(parsed);
}

export function signModelAssuranceArtifact(
  artifact: UnsignedModelAssuranceArtifact,
  privateKeyPem: string,
): ModelAssuranceArtifact {
  const parsed = unsignedModelAssuranceArtifactSchema.parse(artifact);
  const privateKey = crypto.createPrivateKey(normalizePem(privateKeyPem));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Model assurance signing key must be Ed25519");
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const signature = crypto.sign(null, Buffer.from(assurancePayload(parsed), "utf8"), privateKey).toString("base64url");
  return modelAssuranceArtifactSchema.parse({
    ...parsed,
    integrity: {
      algorithm: ASSURANCE_SIGNATURE_ALGORITHM,
      keyId: publicKeyId(publicKey),
      signature,
    },
  });
}

export function verifyModelAssuranceArtifactSignature(
  artifact: ModelAssuranceArtifact,
  publicKeyPem: string,
): AssuranceSignatureVerification {
  try {
    const parsed = modelAssuranceArtifactSchema.parse(artifact);
    const publicKey = crypto.createPublicKey(normalizePem(publicKeyPem));
    if (publicKey.asymmetricKeyType !== "ed25519") {
      return { valid: false, keyId: null, reason: "Configured assurance public key is not Ed25519" };
    }
    const expectedKeyId = publicKeyId(publicKey);
    if (parsed.integrity.keyId !== expectedKeyId) {
      return {
        valid: false,
        keyId: expectedKeyId,
        reason: `Assurance artifact key id ${parsed.integrity.keyId} does not match configured key ${expectedKeyId}`,
      };
    }
    const { integrity: _integrity, ...unsigned } = parsed;
    const valid = crypto.verify(
      null,
      Buffer.from(assurancePayload(unsigned), "utf8"),
      publicKey,
      Buffer.from(parsed.integrity.signature, "base64url"),
    );
    return { valid, keyId: expectedKeyId, reason: valid ? null : "Assurance artifact signature verification failed" };
  } catch (error) {
    return {
      valid: false,
      keyId: null,
      reason: error instanceof Error ? error.message : "Assurance artifact signature verification failed",
    };
  }
}

export function verifyConfiguredModelAssuranceArtifact(
  artifact: ModelAssuranceArtifact,
  environment: NodeJS.ProcessEnv = process.env,
): AssuranceSignatureVerification {
  const publicKeyPem = environment[ASSURANCE_PUBLIC_KEY_ENV];
  if (!publicKeyPem?.trim()) {
    return {
      valid: false,
      keyId: null,
      reason: `${ASSURANCE_PUBLIC_KEY_ENV} is not configured`,
    };
  }
  return verifyModelAssuranceArtifactSignature(artifact, publicKeyPem);
}

export function signConfiguredModelAssuranceArtifact(
  artifact: UnsignedModelAssuranceArtifact,
  environment: NodeJS.ProcessEnv = process.env,
): ModelAssuranceArtifact {
  const privateKeyPem = environment[ASSURANCE_PRIVATE_KEY_ENV];
  if (!privateKeyPem?.trim()) {
    throw new Error(`${ASSURANCE_PRIVATE_KEY_ENV} is not configured`);
  }
  return signModelAssuranceArtifact(artifact, privateKeyPem);
}

export function generateAssuranceSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string; keyId: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    keyId: publicKeyId(publicKey),
  };
}
