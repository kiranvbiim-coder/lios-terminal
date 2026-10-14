import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as asn1js from "asn1js";
import { BasicConstraints, Certificate, ExtKeyUsage } from "pkijs";
import { loadOrCreateDeviceTlsIdentity } from "./deviceTls";

async function temporary(t: { after: (cleanup: () => Promise<void>) => void }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lios-device-tls-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("device TLS creates one private, valid P-256 server identity and concurrent calls retain it", { timeout: 10_000 }, async (t) => {
  const root = await temporary(t);
  const directory = path.join(root, "identity");
  const identities = await Promise.all(Array.from({ length: 8 }, () => loadOrCreateDeviceTlsIdentity(directory)));
  const identity = identities[0]!;
  for (const other of identities) assert.deepEqual(other, identity);
  assert.deepEqual(await readdir(directory), ["identity.json"], "all creation temporaries are cleaned");
  assert.deepEqual(await loadOrCreateDeviceTlsIdentity(directory), identity);
  const certificate = new X509Certificate(identity.certificatePem);
  const key = createPrivateKey(identity.privateKeyPem);
  assert.ok(certificate.verify(certificate.publicKey));
  assert.ok(certificate.checkPrivateKey(key));
  assert.equal(key.asymmetricKeyType, "ec");
  assert.equal(key.asymmetricKeyDetails?.namedCurve, "prime256v1");
  assert.equal(certificate.ca, false);
  assert.deepEqual(certificate.keyUsage, ["1.3.6.1.5.5.7.3.1"]);
  assert.equal(certificate.subject, `CN=LiOS Home ${identity.homeId}`);
  assert.match(identity.homeId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(identity.fingerprint, createHash("sha256").update(certificate.raw).digest("hex"));
  assert.equal(certificate.checkHost("localhost"), "localhost");
  assert.equal(certificate.checkIP("127.0.0.1"), "127.0.0.1");
  assert.equal(certificate.checkIP("::1"), "::1");
  assert.ok(Date.parse(certificate.validFrom) <= Date.now());
  assert.ok(Date.parse(certificate.validTo) > Date.now() + 3650 * 24 * 60 * 60_000);
  const parsed = new Certificate({ schema: asn1js.fromBER(certificate.raw).result });
  const constraints = parsed.extensions!.find((entry) => entry.extnID === "2.5.29.19")!;
  assert.equal(constraints.critical, true);
  assert.equal(new BasicConstraints({ schema: asn1js.fromBER(constraints.extnValue.valueBlock.valueHexView).result }).cA, false);
  const usage = parsed.extensions!.find((entry) => entry.extnID === "2.5.29.15")!;
  assert.equal(usage.critical, true);
  const bits = asn1js.fromBER(usage.extnValue.valueBlock.valueHexView).result;
  assert.ok(bits instanceof asn1js.BitString);
  assert.equal(bits.valueBlock.unusedBits, 7);
  assert.deepEqual([...bits.valueBlock.valueHexView], [0x80]);
  const extended = parsed.extensions!.find((entry) => entry.extnID === "2.5.29.37")!;
  assert.deepEqual(new ExtKeyUsage({ schema: asn1js.fromBER(extended.extnValue.valueBlock.valueHexView).result }).keyPurposes, ["1.3.6.1.5.5.7.3.1"]);
  const file = await lstat(path.join(directory, "identity.json"));
  if (process.platform !== "win32") {
    assert.equal(file.mode & 0o777, 0o600);
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  }
  if (process.getuid) assert.equal(file.uid, process.getuid());
  assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(directory, "identity.json"), "utf8"))).sort(), ["certificatePem", "homeId", "privateKeyPem"]);
});

test("existing malformed identity is refused without replacement", async (t) => {
  const directory = await temporary(t);
  const filename = path.join(directory, "identity.json");
  await writeFile(filename, "{broken", { mode: 0o600 });
  await assert.rejects(loadOrCreateDeviceTlsIdentity(directory), /Invalid existing device TLS identity/);
  assert.equal(await readFile(filename, "utf8"), "{broken");
  assert.deepEqual(await readdir(directory), ["identity.json"]);
});

test("existing mismatched private key and malformed Home UUID are refused", async (t) => {
  const root = await temporary(t);
  const directory = path.join(root, "one");
  const first = await loadOrCreateDeviceTlsIdentity(directory);
  const second = await loadOrCreateDeviceTlsIdentity(path.join(root, "two"));
  const filename = path.join(directory, "identity.json");
  const stored = { certificatePem: first.certificatePem, privateKeyPem: second.privateKeyPem, homeId: first.homeId };
  await writeFile(filename, JSON.stringify(stored), { mode: 0o600 });
  await assert.rejects(loadOrCreateDeviceTlsIdentity(directory), /does not match its private key/);
  await writeFile(filename, JSON.stringify({ ...stored, privateKeyPem: first.privateKeyPem, homeId: "not-a-uuid" }));
  await assert.rejects(loadOrCreateDeviceTlsIdentity(directory), /Invalid existing device TLS identity/);
  await writeFile(filename, JSON.stringify({ ...stored, privateKeyPem: first.privateKeyPem, homeId: second.homeId }));
  await assert.rejects(loadOrCreateDeviceTlsIdentity(directory), /Home UUID does not match/);
});

test("expired identity is refused and retained, never regenerated", async (t) => {
  const directory = await temporary(t);
  const identity = await loadOrCreateDeviceTlsIdentity(directory);
  const original = await readFile(path.join(directory, "identity.json"), "utf8");
  const certificate = new X509Certificate(identity.certificatePem);
  t.mock.method(Date, "now", () => Date.parse(certificate.validTo) + 1);
  await assert.rejects(loadOrCreateDeviceTlsIdentity(directory), /has expired/);
  assert.equal(await readFile(path.join(directory, "identity.json"), "utf8"), original);
});

test("identity file and directory symlinks and insecure modes fail closed", { skip: process.platform === "win32" }, async (t) => {
  const root = await temporary(t);
  const real = path.join(root, "real");
  await loadOrCreateDeviceTlsIdentity(real);
  const linkDirectory = path.join(root, "directory-link");
  await symlink(real, linkDirectory, "dir");
  await assert.rejects(loadOrCreateDeviceTlsIdentity(linkDirectory), /refuses symlink/);
  const fileDirectory = path.join(root, "file-link");
  await mkdir(fileDirectory, { mode: 0o700 });
  await symlink(path.join(real, "identity.json"), path.join(fileDirectory, "identity.json"));
  await assert.rejects(loadOrCreateDeviceTlsIdentity(fileDirectory), /refuses symlink/);
  await chmod(path.join(real, "identity.json"), 0o644);
  await assert.rejects(loadOrCreateDeviceTlsIdentity(real), /insecure permissions/);
  await chmod(path.join(real, "identity.json"), 0o600);
  await chmod(real, 0o755);
  await assert.rejects(loadOrCreateDeviceTlsIdentity(real), /insecure permissions/);
});

test("Windows TLS identity refuses an Everyone-readable ACL", { skip: process.platform !== "win32" }, async (t) => {
  const root = await temporary(t);
  const directory = path.join(root, "windows-private");
  await loadOrCreateDeviceTlsIdentity(directory);
  const filename = path.join(directory, "identity.json");
  execFileSync("icacls.exe", [filename, "/grant", "*S-1-1-0:(R)"], { windowsHide: true });
  await assert.rejects(loadOrCreateDeviceTlsIdentity(directory), /insecure permissions/);
});
