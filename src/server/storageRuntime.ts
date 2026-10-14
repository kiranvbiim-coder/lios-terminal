import crypto from "node:crypto";
import path from "node:path";
import { S3StorageProvider } from "./s3StorageProvider";
import { resolveCredential } from "./credentialVault";
import { dataPath, dataRootIsExplicit, stateDir } from "./dataRoot";
import { EncryptedStorageProvider, FilesystemStorageProvider, StorageUnavailableError, loadOrCreateStorageKey, type StorageProvider } from "./storageProvider";

/**
 * GM-05 selection. Environment today; GM-07 (SecretRef) replaces the S3 secret source.
 *   LIOS_STORAGE_PROVIDER=filesystem|s3   (default filesystem)
 *   LIOS_STORAGE_ENCRYPTION=on            (filesystem: optional; S3: always on, there is no off switch)
 *   LIOS_ATTACHMENT_STORAGE_DIR           (filesystem root for Project attachments; see below)
 *   LIOS_S3_ENDPOINT, LIOS_S3_BUCKET, LIOS_S3_ACCESS_KEY_ID, and the secret as either
 *   LIOS_S3_SECRET_ACCESS_KEY or LIOS_S3_SECRET_ACCESS_KEY_REF (file:/run/secrets/x, env:LIOS_SECRET_X, vault:name),
 *   LIOS_S3_REGION (default us-east-1), LIOS_S3_PREFIX, LIOS_S3_VIRTUAL_HOSTED=true
 */
export type StorageProviderKind = StorageProvider["kind"];

export function configuredStorageKind(env: NodeJS.ProcessEnv = process.env): StorageProviderKind {
  const value = env.LIOS_STORAGE_PROVIDER?.trim().toLowerCase() || "filesystem";
  if (value !== "filesystem" && value !== "s3") throw new StorageUnavailableError(`Unknown LIOS_STORAGE_PROVIDER "${value}".`);
  return value;
}

function filesystemRoot(namespace: string, env: NodeJS.ProcessEnv): string {
  const explicit = env.LIOS_ATTACHMENT_STORAGE_DIR?.trim();
  if (explicit && namespace === "project-attachments") {
    if (!path.isAbsolute(explicit)) throw new StorageUnavailableError();
    return path.resolve(explicit);
  }
  // A server Home on a remote database must choose its blob volume deliberately (LIOS_DATA_ROOT or an explicit
  // directory). Otherwise a process-local filesystem could silently lose files on redeploy while the Project
  // metadata survives.
  if (env.DATABASE_URL && env.LIOS_DESKTOP_PACKAGED !== "true" && !dataRootIsExplicit()) {
    throw new StorageUnavailableError();
  }
  return dataPath(namespace);
}

const cache = new Map<string, StorageProvider>();

/** The blob store for one namespace (for example "project-attachments"). Cached per effective configuration. */
export async function blobStorage(namespace: string, env: NodeJS.ProcessEnv = process.env): Promise<StorageProvider> {
  const kind = configuredStorageKind(env);
  const s3Secret = env.LIOS_S3_SECRET_ACCESS_KEY?.trim()
    || (env.LIOS_S3_SECRET_ACCESS_KEY_REF ? resolveCredential("", env.LIOS_S3_SECRET_ACCESS_KEY_REF) : null)
    || undefined;
  const encrypted = kind === "s3" || env.LIOS_STORAGE_ENCRYPTION?.trim().toLowerCase() === "on";
  const location = kind === "s3"
    ? `${env.LIOS_S3_ENDPOINT}|${env.LIOS_S3_BUCKET}|${env.LIOS_S3_PREFIX ?? ""}|${env.LIOS_S3_ACCESS_KEY_ID}|${crypto.createHash("sha256").update(s3Secret ?? "").digest("hex")}`
    : filesystemRoot(namespace, env);
  const signature = [kind, namespace, encrypted, location, encrypted ? stateDir() : ""].join("\0");
  const cached = cache.get(signature);
  if (cached) return cached;

  let inner: StorageProvider;
  if (kind === "s3") {
    const { LIOS_S3_ENDPOINT: endpoint, LIOS_S3_BUCKET: bucket, LIOS_S3_ACCESS_KEY_ID: accessKeyId } = env;
    const secretAccessKey = s3Secret;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new StorageUnavailableError("S3 storage needs LIOS_S3_ENDPOINT, LIOS_S3_BUCKET, LIOS_S3_ACCESS_KEY_ID and LIOS_S3_SECRET_ACCESS_KEY (or a resolvable LIOS_S3_SECRET_ACCESS_KEY_REF).");
    }
    inner = new S3StorageProvider({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: env.LIOS_S3_REGION?.trim() || "us-east-1",
      prefix: [env.LIOS_S3_PREFIX?.trim(), namespace].filter(Boolean).join("/"),
      virtualHosted: env.LIOS_S3_VIRTUAL_HOSTED?.trim().toLowerCase() === "true",
    });
  } else {
    inner = new FilesystemStorageProvider(filesystemRoot(namespace, env));
  }
  const provider = encrypted
    ? new EncryptedStorageProvider(inner, await loadOrCreateStorageKey(), { acceptPlaintext: kind === "filesystem" })
    : inner;
  cache.set(signature, provider);
  return provider;
}
