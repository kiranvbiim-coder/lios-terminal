import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import {
  StorageIntegrityError,
  StorageNotFoundError,
  StorageUnavailableError,
  assertStorageKey,
  type StorageProvider,
} from "./storageProvider";

/**
 * GM-05: one S3-compatible adapter for AWS S3, Cloudflare R2, MinIO, Wasabi, Backblaze B2 (S3 API),
 * DigitalOcean Spaces and similar. Signature Version 4 is implemented directly on `node:crypto` and
 * `fetch` (no SDK, no new dependency); it is verified against AWS's published example in the tests and
 * against a real MinIO server in the task evidence. Objects are sent in a single PUT (the largest object
 * LiOS writes today is a 20 MB attachment); multipart upload belongs with the first larger writer.
 */

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional key prefix inside the bucket, without surrounding slashes. */
  prefix?: string;
  /** Virtual-hosted addressing (`bucket.host`). Default is path style, which every S3-compatible service accepts. */
  virtualHosted?: boolean;
  timeoutMs?: number;
}

export interface S3ImmutablePutOptions {
  signal: AbortSignal;
  /** Synchronous server-owned destination/credential-generation check immediately before every request. */
  beforeRequest: () => void;
}

export interface S3ImmutablePutReceipt {
  disposition: "created" | "matched";
  contentSha256: string;
}

/** Only a new socket's failed connect certifies that this PUT could not have reached the provider. */
export class S3DispatchNoEffectError extends StorageUnavailableError {
  constructor() {
    super("Object publication could not connect; no request was transmitted.");
    this.name = "S3DispatchNoEffectError";
  }
}

export class S3PublicationOutcomeUnknownError extends StorageUnavailableError {
  constructor() {
    super("Object publication outcome is unknown; no retry was attempted.");
    this.name = "S3PublicationOutcomeUnknownError";
  }
}

export class S3PublicationConflictError extends StorageIntegrityError {
  constructor() {
    super("The immutable publication already exists with different content.");
    this.name = "S3PublicationConflictError";
  }
}

const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");

function hmac(key: crypto.BinaryLike | crypto.KeyObject, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** AWS Signature Version 4 for an S3 request with a single-chunk, hashed payload. */
export function signS3Request(input: {
  method: string;
  host: string;
  canonicalPath: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  payloadSha256: string;
  now: Date;
  extraHeaders?: Record<string, string>;
}): { headers: Record<string, string>; signature: string; canonicalRequest: string } {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.extraHeaders ?? {}).map(([name, value]) => [name.toLowerCase(), value.trim()])),
    host: input.host,
    "x-amz-content-sha256": input.payloadSha256,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method, input.canonicalPath, "", canonicalHeaders, signedHeaders, input.payloadSha256].join("\n");
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, signature, canonicalRequest };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export class S3StorageProvider implements StorageProvider {
  readonly kind = "s3" as const;
  private readonly endpoint: URL;
  private readonly prefix: string;

  constructor(private readonly config: S3StorageConfig) {
    this.endpoint = new URL(config.endpoint);
    // Credentials must never cross the network in clear text. Plain HTTP is for a local MinIO/dev endpoint only.
    if (this.endpoint.protocol !== "https:" && !(this.endpoint.protocol === "http:" && isLoopbackHost(this.endpoint.hostname))) {
      throw new StorageUnavailableError("The S3 endpoint must use https (plain http is allowed only for localhost).");
    }
    if (this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash) {
      throw new StorageUnavailableError("The S3 endpoint must not contain credentials, a query or a fragment.");
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) throw new StorageUnavailableError("Invalid S3 bucket name.");
    if (!config.accessKeyId || !config.secretAccessKey || !config.region) throw new StorageUnavailableError("S3 credentials and region are required.");
    this.prefix = (config.prefix ?? "").replace(/^\/+|\/+$/g, "");
  }

  private request(method: string, key: string, payload: Uint8Array | null, now = new Date(), extraHeaders?: Record<string, string>): { url: string; headers: Record<string, string> } {
    assertStorageKey(key);
    const objectKey = [this.prefix, key].filter(Boolean).join("/");
    const basePath = this.endpoint.pathname.replace(/\/+$/, "");
    const virtual = this.config.virtualHosted === true;
    const encodedKey = objectKey.split("/").map(rfc3986).join("/");
    const canonicalPath = virtual ? `${basePath}/${encodedKey}` : `${basePath}/${rfc3986(this.config.bucket)}/${encodedKey}`;
    const host = virtual ? `${this.config.bucket}.${this.endpoint.host}` : this.endpoint.host;
    const payloadSha256 = payload ? crypto.createHash("sha256").update(payload).digest("hex") : EMPTY_SHA256;
    const signed = signS3Request({
      method,
      host,
      canonicalPath,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      payloadSha256,
      now,
      extraHeaders,
    });
    // fetch supplies Host itself from the URL; every other signed header is sent as signed.
    const headers = { ...signed.headers };
    delete headers.host;
    return { url: `${this.endpoint.protocol}//${host}${canonicalPath}`, headers };
  }

  private async send(method: string, key: string, payload: Uint8Array | null): Promise<Response> {
    const { url, headers } = this.request(method, key, payload);
    try {
      return await fetch(url, {
        method,
        headers,
        body: payload ? Buffer.from(payload) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
      });
    } catch {
      throw new StorageUnavailableError("The S3 endpoint could not be reached.");
    }
  }

  /**
   * Deliberately separate from Home blob PUT: native HTTP performs exactly one request, with no
   * redirect following, socket reuse or hidden fetch retry. Only connect/ECONNREFUSED on that new
   * socket is certified no-effect. Every other failed write requires a read reconciliation.
   */
  private immutableRequest(
    method: "PUT" | "GET",
    key: string,
    payload: Uint8Array | null,
    maxBytes: number,
    options: S3ImmutablePutOptions,
  ): Promise<{ status: number; bytes: Buffer }> {
    const { url, headers } = this.request(method, key, payload, new Date(),
      method === "PUT" ? { "if-none-match": "*", "content-type": "application/json; charset=utf-8" } : undefined);
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(this.config.timeoutMs ?? 30_000)]);
    options.beforeRequest();
    signal.throwIfAborted();
    const { promise, resolve, reject } = Promise.withResolvers<{ status: number; bytes: Buffer }>();
    let connected = false;
    const transport = url.startsWith("https:") ? https : http;
    const request = transport.request(url, { method, headers, signal, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      let length = 0;
      const status = response.statusCode ?? 0;
      const collect = method === "GET" && status === 200;
      if (collect && Number(response.headers["content-length"]) > maxBytes) {
        response.destroy();
        reject(new S3PublicationConflictError());
        return;
      }
      response.on("data", (chunk: Buffer) => {
        if (!collect) return;
        const nextLength = length + chunk.length;
        if (nextLength > maxBytes) {
          response.destroy();
          reject(new S3PublicationConflictError());
        } else {
          length = nextLength;
          chunks.push(chunk);
        }
      });
      response.on("end", () => resolve({ status, bytes: Buffer.concat(chunks, length) }));
      response.on("error", () => reject(new S3PublicationOutcomeUnknownError()));
      response.on("aborted", () => reject(new S3PublicationOutcomeUnknownError()));
    });
    request.on("socket", (socket) => {
      socket.once("connect", () => { connected = true; });
    });
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (options.signal.aborted) {
        reject(new DOMException("Object publication cancelled.", "AbortError"));
      } else if (method === "PUT" && !connected && error.code === "ECONNREFUSED" && error.syscall === "connect") {
        reject(new S3DispatchNoEffectError());
      } else {
        reject(new S3PublicationOutcomeUnknownError());
      }
    });
    // Uint8Array is accepted by node:http; no payload copy is needed.
    request.end(payload ?? undefined);
    return promise;
  }

  /**
   * Single conditional PUT, then hash reconciliation only. A 404 after an ambiguous write does
   * not certify no-effect: the provider may still commit. No branch here retries or overwrites.
   * The target provider must enforce If-None-Match atomically (prove this during provisioning).
   */
  async putImmutable(key: string, bytes: Uint8Array, options: S3ImmutablePutOptions): Promise<S3ImmutablePutReceipt> {
    assertStorageKey(key);
    const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    let response: { status: number; bytes: Buffer };
    try {
      response = await this.immutableRequest("PUT", key, bytes, 0, options);
    } catch (error) {
      if (error instanceof S3DispatchNoEffectError || options.signal.aborted) throw error;
      if (!(error instanceof S3PublicationOutcomeUnknownError)) throw error;
      return this.reconcileImmutable(key, bytes.byteLength, contentSha256, options);
    }
    if (response.status >= 200 && response.status < 300) return { disposition: "created", contentSha256 };
    if (response.status === 409 || response.status === 412 || response.status >= 500) {
      return this.reconcileImmutable(key, bytes.byteLength, contentSha256, options);
    }
    // A received 4xx or refused redirect is not a reason to replay the write.
    throw new StorageUnavailableError(`S3 rejected immutable publication (HTTP ${response.status}).`);
  }

  private async reconcileImmutable(
    key: string,
    expectedBytes: number,
    contentSha256: string,
    options: S3ImmutablePutOptions,
  ): Promise<S3ImmutablePutReceipt> {
    const response = await this.immutableRequest("GET", key, null, expectedBytes, options);
    if (response.status !== 200) throw new S3PublicationOutcomeUnknownError();
    const actualSha256 = crypto.createHash("sha256").update(response.bytes).digest("hex");
    if (response.bytes.length !== expectedBytes || actualSha256 !== contentSha256) throw new S3PublicationConflictError();
    return { disposition: "matched", contentSha256 };
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const response = await this.send("PUT", key, bytes);
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) throw new StorageUnavailableError(`S3 rejected the upload (HTTP ${response.status}).`);
  }

  async get(key: string, options: { maxBytes?: number } = {}): Promise<Buffer> {
    const response = await this.send("GET", key, null);
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      throw new StorageNotFoundError();
    }
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      throw new StorageUnavailableError(`S3 rejected the download (HTTP ${response.status}).`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (options.maxBytes !== undefined && Number.isFinite(declared) && declared > options.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new StorageIntegrityError("Stored object is unavailable or invalid.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || (options.maxBytes !== undefined && bytes.length > options.maxBytes)) {
      throw new StorageIntegrityError("Stored object is unavailable or invalid.");
    }
    return bytes;
  }

  async delete(key: string): Promise<void> {
    const response = await this.send("DELETE", key, null);
    await response.arrayBuffer().catch(() => undefined);
    // S3 answers 204 for a missing key; some compatibles answer 404. Both mean "gone".
    if (!response.ok && response.status !== 404) throw new StorageUnavailableError(`S3 rejected the delete (HTTP ${response.status}).`);
  }
}
