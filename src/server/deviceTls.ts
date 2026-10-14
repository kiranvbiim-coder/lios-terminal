import { createHash, createPrivateKey, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { networkInterfaces } from "node:os";
import path from "node:path";
import * as asn1js from "asn1js";
import { AltName, AttributeTypeAndValue, BasicConstraints, Certificate, CryptoEngine, Extension, ExtKeyUsage, GeneralName } from "pkijs";
import { z } from "zod";

export interface DeviceTlsIdentity {
  certificatePem: string;
  privateKeyPem: string;
  /** SHA-256 of the leaf certificate's raw DER, lowercase without separators. */
  fingerprint: string;
  homeId: string;
}

const identitySchema = z.object({
  certificatePem: z.string().max(32_768),
  privateKeyPem: z.string().max(16_384),
  homeId: z.string().uuid(),
}).strict();
const IDENTITY_FILE = "identity.json";
const MAX_IDENTITY_BYTES = 64 * 1024;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** ACE principals only — never match `C:\\Users\\...` paths in icacls header lines. */
const WINDOWS_INSECURE_ACL_MARKERS = [
  /\beveryone\b/i,
  /\*S-1-1-0\b/i,
  /BUILTIN\\Users\b/i,
  /NT AUTHORITY\\Authenticated Users\b/i,
  /\*S-1-5-32-545\b/,
  /\*S-1-5-11\b/,
];

function icaclsAceText(stdout: string): string {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const segments: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index === 0) {
      const grant = line.match(/(\S+:\\[^:]+:\([^)]*\))+$/);
      if (grant) segments.push(grant[0]!);
      continue;
    }
    segments.push(line);
  }
  return segments.join("\n");
}

async function privatizeWindowsPath(location: string, container: boolean): Promise<void> {
  const principal = process.env.USERDOMAIN && process.env.USERNAME
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME ?? "";
  if (!principal) throw new Error("Device TLS identity cannot resolve the current Windows user for ACL hardening.");
  const grant = container ? `${principal}:(OI)(CI)F` : `${principal}:(F)`;
  await execFileAsync("icacls.exe", [location, "/inheritance:r", "/grant:r", grant], { windowsHide: true, timeout: 10_000 });
}

async function assertPrivateWindowsAcl(location: string): Promise<void> {
  const { stdout } = await execFileAsync("icacls.exe", [location], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const aceText = icaclsAceText(stdout);
  for (const pattern of WINDOWS_INSECURE_ACL_MARKERS) {
    if (pattern.test(aceText)) throw new Error(`Device TLS identity has insecure permissions: ${location}`);
  }
  const user = process.env.USERNAME?.toLowerCase();
  if (user && !aceText.toLowerCase().includes(user)) {
    throw new Error(`Device TLS identity is not accessible to the current user: ${location}`);
  }
}

async function assertPrivate(stat: Stats, location: string, directory: boolean): Promise<void> {
  if (stat.isSymbolicLink()) throw new Error(`Device TLS identity refuses symlink: ${location}`);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Device TLS identity requires a ${directory ? "directory" : "regular file"}: ${location}`);
  if (process.platform === "win32") {
    await assertPrivateWindowsAcl(location);
    return;
  }
  if ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) throw new Error(`Device TLS identity has insecure permissions: ${location} (requires ${directory ? "0700" : "0600"})`);
  if (process.getuid && stat.uid !== process.getuid()) throw new Error(`Device TLS identity has a different owner: ${location}`);
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function validateIdentity(value: unknown): DeviceTlsIdentity {
  const stored = identitySchema.parse(value);
  if (!/^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\n?$/.test(stored.certificatePem)
    || !/^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\r\n]+-----END PRIVATE KEY-----\n?$/.test(stored.privateKeyPem)) {
    throw new Error("Device TLS identity contains malformed PEM key material.");
  }
  const certificate = new X509Certificate(stored.certificatePem);
  const privateKey = createPrivateKey(stored.privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    || certificate.publicKey.asymmetricKeyType !== "ec" || certificate.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Device TLS identity must use ECDSA P-256.");
  }
  if (!certificate.checkPrivateKey(privateKey)) throw new Error("Device TLS identity certificate does not match its private key.");
  if (certificate.subject !== certificate.issuer || !certificate.verify(certificate.publicKey)) throw new Error("Device TLS identity certificate is not validly self-signed.");
  const now = Date.now();
  const notBefore = Date.parse(certificate.validFrom);
  const notAfter = Date.parse(certificate.validTo);
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notBefore > now) throw new Error("Device TLS identity certificate is not yet valid.");
  if (notAfter <= now) throw new Error("Device TLS identity certificate has expired; explicit owner recovery is required.");
  if (certificate.ca || !certificate.keyUsage?.includes("1.3.6.1.5.5.7.3.1")) throw new Error("Device TLS identity certificate is not a non-CA TLS server certificate.");
  if (certificate.subject !== `CN=LiOS Home ${stored.homeId}`) throw new Error("Device TLS identity Home UUID does not match its certificate.");
  return { ...stored, fingerprint: createHash("sha256").update(certificate.raw).digest("hex") };
}

async function readIdentity(directory: string, directoryStat: Stats): Promise<DeviceTlsIdentity | null> {
  const filename = path.join(directory, IDENTITY_FILE);
  let before: Stats;
  try {
    before = await lstat(filename);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  await assertPrivate(before, filename, false);
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    await assertPrivate(actual, filename, false);
    if (actual.size > MAX_IDENTITY_BYTES) throw new Error("Device TLS identity file exceeds its size limit.");
    // On Windows the dev/ino from lstat (path) and fstat (handle) are not comparable (observed on CI: this check rejected the genuine
    // file), and O_NOFOLLOW does not exist. The owner-only ACL verified above on file and directory is the boundary there.
    if (process.platform !== "win32" && !sameFile(before, actual)) throw new Error("Device TLS identity file changed while reading.");
    const currentDirectory = await lstat(directory);
    await assertPrivate(currentDirectory, directory, true);
    if (!sameFile(directoryStat, currentDirectory)) throw new Error("Device TLS identity directory changed while reading.");
    const content = await handle.readFile("utf8");
    try {
      return validateIdentity(JSON.parse(content));
    } catch (error) {
      throw new Error(`Invalid existing device TLS identity: ${error instanceof Error ? error.message : "malformed key material"}`, { cause: error });
    }
  } finally {
    await handle.close();
  }
}

function pem(label: string, bytes: ArrayBuffer): string {
  const encoded = Buffer.from(bytes).toString("base64");
  return `-----BEGIN ${label}-----\n${encoded.match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
}

async function generateIdentity(): Promise<DeviceTlsIdentity> {
  // PKIjs handles certificate structure and ECDSA signature encoding; no process/global crypto overrides.
  const engine = new CryptoEngine({ name: "LiOS device TLS", crypto: globalThis.crypto });
  const keys = await engine.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const homeId = randomUUID();
  const certificate = new Certificate();
  certificate.version = 2;
  const serial = randomBytes(20);
  serial[0] = (serial[0]! & 0x7f) | 1;
  certificate.serialNumber = new asn1js.Integer({ valueHex: serial.buffer.slice(serial.byteOffset, serial.byteOffset + serial.byteLength) });
  for (const name of [certificate.subject, certificate.issuer]) {
    name.typesAndValues.push(new AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: `LiOS Home ${homeId}` }) }));
  }
  certificate.notBefore.value = new Date(Date.now() - 5 * 60_000);
  const expiry = new Date();
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 10);
  certificate.notAfter.value = expiry;
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey, engine);
  const ipv4 = new Set(["127.0.0.1"]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const address of entries ?? []) {
      if (!address.internal && address.family === "IPv4" && ipv4.size < 32) ipv4.add(address.address);
    }
  }
  const names = [new GeneralName({ type: 2, value: "localhost" })];
  for (const address of ipv4) {
    names.push(new GeneralName({ type: 7, value: new asn1js.OctetString({ valueHex: Uint8Array.from(address.split("."), Number).buffer }) }));
  }
  const ipv6Loopback = new Uint8Array(16);
  ipv6Loopback[15] = 1;
  names.push(new GeneralName({ type: 7, value: new asn1js.OctetString({ valueHex: ipv6Loopback.buffer }) }));
  certificate.extensions = [
    new Extension({ extnID: "2.5.29.19", critical: true, extnValue: new BasicConstraints({ cA: false }).toSchema().toBER(false) }),
    new Extension({ extnID: "2.5.29.15", critical: true, extnValue: new asn1js.BitString({ unusedBits: 7, valueHex: new Uint8Array([0x80]).buffer }).toBER(false) }),
    new Extension({ extnID: "2.5.29.37", extnValue: new ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.1"] }).toSchema().toBER(false) }),
    new Extension({ extnID: "2.5.29.17", extnValue: new AltName({ altNames: names }).toSchema().toBER(false) }),
  ];
  await certificate.sign(keys.privateKey, "SHA-256", engine);
  return validateIdentity({
    certificatePem: pem("CERTIFICATE", certificate.toSchema(true).toBER(false)),
    privateKeyPem: pem("PRIVATE KEY", await engine.exportKey("pkcs8", keys.privateKey)),
    homeId,
  });
}

/** Creates one immutable, owner-private Home identity; never repairs/replaces an existing identity implicitly. */
export async function loadOrCreateDeviceTlsIdentity(directory: string): Promise<DeviceTlsIdentity> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") await privatizeWindowsPath(directory, true);
  const directoryStat = await lstat(directory);
  await assertPrivate(directoryStat, directory, true);
  const existing = await readIdentity(directory, directoryStat);
  if (existing) return existing;
  const identity = await generateIdentity();
  const temporary = path.join(directory, `.identity-${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      await assertPrivate(await handle.stat(), temporary, false);
      await handle.writeFile(`${JSON.stringify({ certificatePem: identity.certificatePem, privateKeyPem: identity.privateKeyPem, homeId: identity.homeId })}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (process.platform === "win32") await privatizeWindowsPath(temporary, false);
    // Publish only a fully written file; linking cannot overwrite a competing creator.
    const currentDirectory = await lstat(directory);
    await assertPrivate(currentDirectory, directory, true);
    if (!sameFile(directoryStat, currentDirectory)) throw new Error("Device TLS identity directory changed while creating.");
    try {
      await link(temporary, path.join(directory, IDENTITY_FILE));
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    const published = await readIdentity(directory, directoryStat);
    if (!published) throw new Error("Device TLS identity disappeared while creating.");
    return published;
  } finally {
    await unlink(temporary);
  }
}
