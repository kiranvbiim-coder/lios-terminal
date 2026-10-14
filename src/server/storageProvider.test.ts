import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { S3StorageProvider, signS3Request } from "./s3StorageProvider";
import {
  EncryptedStorageProvider,
  FilesystemStorageProvider,
  StorageIntegrityError,
  StorageNotFoundError,
  StorageUnavailableError,
  loadOrCreateStorageKey,
} from "./storageProvider";
import { blobStorage } from "./storageRuntime";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-storage-"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const KEY = "1/2/3f1c2b7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f.blob";

test("filesystem provider stores privately, refuses escaping keys and symlinked objects", async () => {
  const dir = path.join(root, "fs");
  const provider = new FilesystemStorageProvider(dir);
  await provider.put(KEY, Buffer.from("hello"));
  assert.equal((await provider.get(KEY)).toString(), "hello");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dir, KEY)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(path.join(dir, KEY))).mode & 0o777, 0o700);
  }
  for (const bad of ["../x", "a/../../x", "/abs", "a//b", "a/.hidden-ok/../b", "a\\b", ""]) {
    await assert.rejects(provider.put(bad, Buffer.from("x")), StorageIntegrityError, bad);
  }
  await assert.rejects(provider.get("1/2/missing.blob"), StorageNotFoundError);
  await assert.rejects(provider.get(KEY, { maxBytes: 2 }), StorageIntegrityError);
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(dir, KEY), path.join(dir, "1/2/link.blob"));
    await assert.rejects(provider.get("1/2/link.blob"), StorageUnavailableError);
  }
  await provider.delete(KEY);
  await provider.delete(KEY);
  await assert.rejects(provider.get(KEY), StorageNotFoundError);
});

test("encryption happens before the provider, binds the object to its key and never downgrades remote objects", async () => {
  const dir = path.join(root, "enc");
  const inner = new FilesystemStorageProvider(dir);
  const key = crypto.randomBytes(32);
  const provider = new EncryptedStorageProvider(inner, key);
  const secret = Buffer.from("quarterly numbers: 4242");
  await provider.put(KEY, secret);
  const onDisk = fs.readFileSync(path.join(dir, KEY));
  assert.equal(onDisk.includes(secret), false, "plaintext must not reach the provider");
  assert.equal((await provider.get(KEY)).toString(), secret.toString());

  // The same plaintext encrypts differently each time (random nonce).
  await provider.put("1/2/other.blob", secret);
  assert.notDeepEqual(fs.readFileSync(path.join(dir, "1/2/other.blob")), onDisk);

  // Moving ciphertext to another key fails authentication.
  fs.copyFileSync(path.join(dir, KEY), path.join(dir, "1/2/moved.blob"));
  await assert.rejects(provider.get("1/2/moved.blob"), /failed authentication/);

  // A flipped bit fails; a different master key is named, not silently mis-decrypted.
  const flipped = Buffer.from(onDisk);
  flipped[flipped.length - 20] ^= 1;
  fs.writeFileSync(path.join(dir, "1/2/flipped.blob"), flipped);
  await assert.rejects(provider.get("1/2/flipped.blob"), /failed authentication/);
  await assert.rejects(new EncryptedStorageProvider(inner, crypto.randomBytes(32)).get(KEY), /different storage key/);

  // Plaintext written by someone else (or before encryption was enabled) is refused unless the caller opted in.
  await inner.put("1/2/legacy.blob", Buffer.from("legacy"));
  await assert.rejects(provider.get("1/2/legacy.blob"), /not encrypted/);
  assert.equal((await new EncryptedStorageProvider(inner, key, { acceptPlaintext: true }).get("1/2/legacy.blob")).toString(), "legacy");
});

test("storage key is generated once, owner-only, and a permissive or malformed file is refused", async () => {
  const dir = path.join(root, "state");
  const first = await loadOrCreateStorageKey(dir);
  assert.equal(first.length, 32);
  assert.deepEqual(await loadOrCreateStorageKey(dir), first);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dir, "storage.key")).mode & 0o777, 0o600);
    fs.chmodSync(path.join(dir, "storage.key"), 0o644);
    await assert.rejects(loadOrCreateStorageKey(dir), /owner-only/);
    fs.chmodSync(path.join(dir, "storage.key"), 0o600);
  }
  fs.writeFileSync(path.join(dir, "storage.key"), "not-a-key\n", { mode: 0o600 });
  await assert.rejects(loadOrCreateStorageKey(dir), /malformed/);
});

test("SigV4 matches the AWS documented GET Object example", () => {
  const signed = signS3Request({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    canonicalPath: "/test.txt",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    payloadSha256: crypto.createHash("sha256").update("").digest("hex"),
    now: new Date("2013-05-24T00:00:00Z"),
    extraHeaders: { Range: "bytes=0-9" },
  });
  assert.equal(signed.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

function fakeS3(secretAccessKey: string) {
  const objects = new Map<string, Buffer>();
  const seen: Array<{ method: string; url: string; auth: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: String(req.headers.authorization) });
      const amzDate = String(req.headers["x-amz-date"]);
      const payload = crypto.createHash("sha256").update(body).digest("hex");
      const expected = signS3Request({
        method: req.method ?? "",
        host: String(req.headers.host),
        canonicalPath: (req.url ?? "").split("?")[0] ?? "",
        region: "test-1",
        accessKeyId: "AKIATEST",
        secretAccessKey,
        payloadSha256: payload,
        now: new Date(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`),
      });
      if (req.headers["x-amz-content-sha256"] !== payload || req.headers.authorization !== expected.headers.authorization) {
        res.writeHead(403).end();
        return;
      }
      const key = req.url ?? "";
      if (req.method === "PUT") { objects.set(key, body); res.writeHead(200).end(); }
      else if (req.method === "GET") { const found = objects.get(key); found ? res.writeHead(200, { "content-length": found.length }).end(found) : res.writeHead(404).end(); }
      else if (req.method === "DELETE") { objects.delete(key); res.writeHead(204).end(); }
      else res.writeHead(405).end();
    });
  });
  return { server, objects, seen };
}

test("S3 provider signs every request, stores only ciphertext and maps missing/denied objects", async (t) => {
  const { server, objects, seen } = fakeS3("s3cret");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const env = {
    LIOS_STORAGE_PROVIDER: "s3",
    LIOS_S3_ENDPOINT: `http://127.0.0.1:${port}`,
    LIOS_S3_BUCKET: "lios-bucket",
    LIOS_S3_REGION: "test-1",
    LIOS_S3_ACCESS_KEY_ID: "AKIATEST",
    LIOS_S3_SECRET_ACCESS_KEY_REF: `file:${path.join(root, "s3-root", "secrets", "s3-secret")}`,
    LIOS_S3_PREFIX: "home one",
    LIOS_DATA_ROOT: path.join(root, "s3-root"),
  } satisfies NodeJS.ProcessEnv;
  const previous = process.env.LIOS_DATA_ROOT;
  process.env.LIOS_DATA_ROOT = env.LIOS_DATA_ROOT;
  t.after(() => { if (previous === undefined) delete process.env.LIOS_DATA_ROOT; else process.env.LIOS_DATA_ROOT = previous; });

  fs.mkdirSync(path.join(root, "s3-root", "secrets"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(root, "s3-root", "secrets", "s3-secret"), "s3cret\n", { mode: 0o600 });
  const storage = await blobStorage("project-attachments", env);
  assert.equal(storage.kind, "s3");
  const plaintext = Buffer.from("balance sheet 987654321");
  await storage.put(KEY, plaintext);
  const [stored] = [...objects.entries()];
  assert.equal(stored![0], `/lios-bucket/home%20one/project-attachments/${KEY}`, "prefix, namespace and RFC3986 encoding");
  assert.equal(stored![1].includes(plaintext), false, "the bucket only ever sees ciphertext");
  assert.equal((await storage.get(KEY)).toString(), plaintext.toString());
  await assert.rejects(storage.get("1/2/absent.blob"), StorageNotFoundError);
  await storage.delete(KEY);
  await assert.rejects(storage.get(KEY), StorageNotFoundError);
  assert.ok(seen.every((entry) => /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/test-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(entry.auth)));

  const wrongSecret = new S3StorageProvider({ endpoint: env.LIOS_S3_ENDPOINT, bucket: "lios-bucket", region: "test-1", accessKeyId: "AKIATEST", secretAccessKey: "nope" });
  await assert.rejects(wrongSecret.put(KEY, plaintext), /HTTP 403/);
});

test("S3 configuration refuses cleartext remote endpoints and incomplete settings", async () => {
  const base = { bucket: "lios-bucket", region: "us-east-1", accessKeyId: "a", secretAccessKey: "b" };
  assert.throws(() => new S3StorageProvider({ ...base, endpoint: "http://s3.example.com" }), /https/);
  assert.throws(() => new S3StorageProvider({ ...base, endpoint: "https://user:pw@s3.example.com" }), /credentials/);
  assert.throws(() => new S3StorageProvider({ ...base, endpoint: "https://s3.example.com", bucket: "Bad_Bucket" }), /bucket/);
  await assert.rejects(blobStorage("project-attachments", { LIOS_STORAGE_PROVIDER: "s3", LIOS_S3_ENDPOINT: "https://s3.example.com" }), /needs LIOS_S3_ENDPOINT/);
  await assert.rejects(blobStorage("project-attachments", { LIOS_STORAGE_PROVIDER: "azure" }), /Unknown LIOS_STORAGE_PROVIDER/);
});
