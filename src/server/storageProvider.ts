import crypto from "node:crypto";
import { constants } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { stateDir } from "./dataRoot";

/**
 * GM-05: the user-owned blob seam. Reference implementation is the former `projectAttachmentStore`
 * filesystem code (atomic write, private modes, O_NOFOLLOW reads). Keys are `/`-separated segments
 * chosen by the caller (`<userId>/<projectId>/<attachmentId>.blob`); they never carry a filesystem path.
 */
export interface StorageProvider {
  readonly kind: "filesystem" | "s3";
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string, options?: { maxBytes?: number }): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class StorageUnavailableError extends Error {
  constructor(message = "Object storage is unavailable.") {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export class StorageNotFoundError extends Error {
  constructor() {
    super("Stored object was not found.");
    this.name = "StorageNotFoundError";
  }
}

export class StorageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageIntegrityError";
  }
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertStorageKey(key: string): string[] {
  const segments = key.split("/");
  if (key.length > 512 || !segments.length || segments.some((segment) => !SEGMENT.test(segment) || segment === "..")) {
    throw new StorageIntegrityError("Invalid storage key.");
  }
  return segments;
}

export class FilesystemStorageProvider implements StorageProvider {
  readonly kind = "filesystem" as const;

  constructor(private readonly root: string) {
    if (!path.isAbsolute(root)) throw new StorageUnavailableError();
  }

  private locate(key: string): { directory: string; target: string } {
    const segments = assertStorageKey(key);
    const target = path.resolve(this.root, ...segments);
    const relative = path.relative(this.root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new StorageIntegrityError("Invalid storage key.");
    return { directory: path.dirname(target), target };
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const { directory, target } = this.locate(key);
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") await fs.chmod(directory, 0o700);
    } catch {
      throw new StorageUnavailableError();
    }
    const temporary = path.join(directory, `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
    let handle: FileHandle | null = null;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, target);
      if (process.platform !== "win32") await fs.chmod(target, 0o600);
    } catch {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
      throw new StorageUnavailableError();
    }
  }

  async get(key: string, options: { maxBytes?: number } = {}): Promise<Buffer> {
    const { target } = this.locate(key);
    let handle: FileHandle;
    try {
      handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StorageNotFoundError();
      throw new StorageUnavailableError();
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0 || (options.maxBytes !== undefined && stat.size > options.maxBytes)) {
        throw new StorageIntegrityError("Stored object is unavailable or invalid.");
      }
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async delete(key: string): Promise<void> {
    const { target } = this.locate(key);
    await fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw new StorageUnavailableError();
    });
  }
}

const MAGIC = Buffer.from("LIOSENC1");
const KEY_ID_BYTES = 8;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + KEY_ID_BYTES + NONCE_BYTES;

/** Distinct from storage credentials and from the credential vault key. Auto-created, owner-only. */
export async function loadOrCreateStorageKey(directory = stateDir()): Promise<Buffer> {
  const file = path.join(directory, "storage.key");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const handle = await fs.open(file, "wx", 0o600);
    try {
      await handle.writeFile(`${crypto.randomBytes(32).toString("hex")}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new StorageUnavailableError("The storage encryption key could not be created.");
  }
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
      throw new StorageIntegrityError("storage.key must be a regular owner-only file.");
    }
    const text = (await handle.readFile("utf8")).trim();
    if (!/^[0-9a-f]{64}$/.test(text)) throw new StorageIntegrityError("storage.key is malformed.");
    return Buffer.from(text, "hex");
  } finally {
    await handle.close();
  }
}

/**
 * Encrypts before the inner provider ever sees the bytes (AES-256-GCM, random 96-bit nonce per object).
 * The storage key and the key id are authenticated data, so an object cannot be swapped to another key
 * or silently re-encrypted under another master key. `acceptPlaintext` exists only to read blobs written
 * before encryption was switched on for a local filesystem; remote providers never accept it, because
 * whoever controls the bucket could otherwise downgrade an object to plaintext.
 */
export class EncryptedStorageProvider implements StorageProvider {
  private readonly keyId: Buffer;

  constructor(
    private readonly inner: StorageProvider,
    private readonly masterKey: Buffer,
    private readonly options: { acceptPlaintext?: boolean } = {},
  ) {
    if (masterKey.length !== 32) throw new StorageIntegrityError("Storage encryption key must be 32 bytes.");
    this.keyId = crypto.createHash("sha256").update("lios-storage-key-id").update(masterKey).digest().subarray(0, KEY_ID_BYTES);
  }

  get kind(): StorageProvider["kind"] {
    return this.inner.kind;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertStorageKey(key);
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.masterKey, nonce);
    cipher.setAAD(this.aad(key));
    const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
    await this.inner.put(key, Buffer.concat([MAGIC, this.keyId, nonce, body, cipher.getAuthTag()]));
  }

  async get(key: string, options: { maxBytes?: number } = {}): Promise<Buffer> {
    assertStorageKey(key);
    const stored = await this.inner.get(key, options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes + HEADER_BYTES + TAG_BYTES });
    if (!stored.subarray(0, MAGIC.length).equals(MAGIC)) {
      if (this.options.acceptPlaintext) return stored;
      throw new StorageIntegrityError("Stored object is not encrypted; refusing to read it.");
    }
    if (stored.length < HEADER_BYTES + TAG_BYTES) throw new StorageIntegrityError("Stored object is truncated.");
    const keyId = stored.subarray(MAGIC.length, MAGIC.length + KEY_ID_BYTES);
    if (!keyId.equals(this.keyId)) throw new StorageIntegrityError("Stored object was encrypted with a different storage key.");
    const nonce = stored.subarray(MAGIC.length + KEY_ID_BYTES, HEADER_BYTES);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.masterKey, nonce);
    decipher.setAAD(this.aad(key));
    decipher.setAuthTag(stored.subarray(stored.length - TAG_BYTES));
    try {
      return Buffer.concat([decipher.update(stored.subarray(HEADER_BYTES, stored.length - TAG_BYTES)), decipher.final()]);
    } catch {
      throw new StorageIntegrityError("Stored object failed authentication; it was modified or moved.");
    }
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  private aad(key: string): Buffer {
    return Buffer.concat([MAGIC, this.keyId, Buffer.from(key, "utf8")]);
  }
}
