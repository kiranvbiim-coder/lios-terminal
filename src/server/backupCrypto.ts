import crypto from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/**
 * Passphrase-encrypted backup container (`.liosbak`). scrypt derives a 256-bit key; the stream is cut into
 * 1 MiB frames, each AES-256-GCM with a counter nonce. Header, frame index and a "final" flag are authenticated,
 * so truncation, reordering and frame deletion are detected, not just bit flips.
 *
 *   header: "LIOSBAK1" | log2(N) | r | p | salt[16] | noncePrefix[4]
 *   frame : final[1] | ciphertextLength u32be | ciphertext+tag
 */

const MAGIC = Buffer.from("LIOSBAK1");
const SALT_BYTES = 16;
const PREFIX_BYTES = 4;
const HEADER_BYTES = MAGIC.length + 3 + SALT_BYTES + PREFIX_BYTES;
const FRAME_BYTES = 1024 * 1024;
const TAG_BYTES = 16;
const SCRYPT = { logN: 15, r: 8, p: 1 } as const;

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupCryptoError";
  }
}

function deriveKey(passphrase: string, salt: Buffer, logN: number, r: number, p: number): Buffer {
  if (logN < 14 || logN > 20 || r < 1 || r > 16 || p < 1 || p > 4) throw new BackupCryptoError("Unsupported backup key-derivation parameters.");
  const N = 2 ** logN;
  return crypto.scryptSync(passphrase.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * N * r });
}

function frameNonce(prefix: Buffer, index: number): Buffer {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeBigUInt64BE(BigInt(index), 4);
  return nonce;
}

function frameAad(header: Buffer, index: number, final: boolean): Buffer {
  const tail = Buffer.alloc(9);
  tail.writeBigUInt64BE(BigInt(index), 0);
  tail[8] = final ? 1 : 0;
  return Buffer.concat([header, tail]);
}

export class BackupEncryptStream extends Transform {
  private readonly header: Buffer;
  private readonly key: Buffer;
  private readonly prefix: Buffer;
  private buffered: Buffer[] = [];
  private bufferedBytes = 0;
  private index = 0;
  private started = false;

  constructor(passphrase: string) {
    super();
    if (passphrase.length < 12) throw new BackupCryptoError("The backup passphrase must be at least 12 characters.");
    const salt = crypto.randomBytes(SALT_BYTES);
    this.prefix = crypto.randomBytes(PREFIX_BYTES);
    this.header = Buffer.concat([MAGIC, Buffer.from([SCRYPT.logN, SCRYPT.r, SCRYPT.p]), salt, this.prefix]);
    this.key = deriveKey(passphrase, salt, SCRYPT.logN, SCRYPT.r, SCRYPT.p);
  }

  private seal(plain: Buffer, final: boolean): Buffer {
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, frameNonce(this.prefix, this.index));
    cipher.setAAD(frameAad(this.header, this.index, final));
    const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    this.index += 1;
    const frameHeader = Buffer.alloc(5);
    frameHeader[0] = final ? 1 : 0;
    frameHeader.writeUInt32BE(body.length, 1);
    return Buffer.concat([frameHeader, body]);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      if (!this.started) {
        this.push(this.header);
        this.started = true;
      }
      this.buffered.push(chunk);
      this.bufferedBytes += chunk.length;
      // Always keep at least one byte back so the last frame can carry the final flag.
      while (this.bufferedBytes > FRAME_BYTES) {
        const all = Buffer.concat(this.buffered);
        this.push(this.seal(all.subarray(0, FRAME_BYTES), false));
        const rest = all.subarray(FRAME_BYTES);
        this.buffered = [rest];
        this.bufferedBytes = rest.length;
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      if (!this.started) this.push(this.header);
      this.push(this.seal(Buffer.concat(this.buffered), true));
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}

export class BackupDecryptStream extends Transform {
  private pending = Buffer.alloc(0);
  private header: Buffer | null = null;
  private key: Buffer | null = null;
  private index = 0;
  private sawFinal = false;

  constructor(private readonly passphrase: string) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.pending = Buffer.concat([this.pending, chunk]);
      if (!this.header) {
        if (this.pending.length < HEADER_BYTES) return callback();
        this.header = this.pending.subarray(0, HEADER_BYTES);
        this.pending = this.pending.subarray(HEADER_BYTES);
        if (!this.header.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupCryptoError("This is not an encrypted LiOS backup.");
        const [logN, r, p] = [this.header[8] as number, this.header[9] as number, this.header[10] as number];
        this.key = deriveKey(this.passphrase, this.header.subarray(11, 11 + SALT_BYTES), logN, r, p);
      }
      for (;;) {
        if (this.sawFinal) {
          if (this.pending.length) throw new BackupCryptoError("Unexpected data after the end of the encrypted backup.");
          break;
        }
        if (this.pending.length < 5) break;
        const final = this.pending[0] === 1;
        const length = this.pending.readUInt32BE(1);
        if (length < TAG_BYTES || length > FRAME_BYTES + TAG_BYTES) throw new BackupCryptoError("Encrypted backup frame is malformed.");
        if (this.pending.length < 5 + length) break;
        const body = this.pending.subarray(5, 5 + length);
        this.pending = this.pending.subarray(5 + length);
        const decipher = crypto.createDecipheriv("aes-256-gcm", this.key as Buffer, frameNonce((this.header as Buffer).subarray(HEADER_BYTES - PREFIX_BYTES), this.index));
        decipher.setAAD(frameAad(this.header as Buffer, this.index, final));
        decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
        try {
          this.push(Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]));
        } catch {
          throw new BackupCryptoError("Wrong passphrase, or the backup is corrupted or has been modified.");
        }
        this.index += 1;
        if (final) this.sawFinal = true;
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    callback(this.sawFinal ? null : new BackupCryptoError("The encrypted backup is truncated."));
  }
}

export function isEncryptedBackupHeader(first: Buffer): boolean {
  return first.subarray(0, MAGIC.length).equals(MAGIC);
}
