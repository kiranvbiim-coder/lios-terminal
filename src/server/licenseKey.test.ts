import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { createSignedAsymmetricOfflineLicenseLease, licenseKeyId, verifyLeaseAgainstTrustAnchors } from "./licenseLease";
import {
  importLicenseFile,
  licenseStatus,
  LICENSE_KEY_PREFIX,
  LicenseImportError,
  MAX_LICENSE_KEY_CHARS,
  parseLicenseKey,
  serializeLicenseFile,
  serializeLicenseKey,
} from "./licenseFile";

function signer() {
  const pair = generateKeyPairSync("ed25519");
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { privatePem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicPem, keyId: licenseKeyId(publicPem) };
}

const vendor = signer();
const anchors = { [vendor.keyId]: vendor.publicPem };
const now = new Date("2026-10-30T12:00:00Z");

function lease(overrides: Record<string, unknown> = {}, key = vendor) {
  return createSignedAsymmetricOfflineLicenseLease({
    organizationId: 1, licenseId: 7, status: "active", seatsPurchased: 1,
    issuedAt: now.toISOString(), expiresAt: "2027-10-30T23:59:59.999Z", keyId: key.keyId,
    planCode: "pro", entitlementMode: "unrestricted", ...overrides,
  }, key.privatePem);
}

function freshEnv(): NodeJS.ProcessEnv {
  return { LIOS_LICENSE_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lios-key-")) };
}

function refusal(action: () => unknown): string {
  try { action(); } catch (error) {
    assert.ok(error instanceof LicenseImportError, `expected a LicenseImportError, got ${String(error)}`);
    return error.message;
  }
  assert.fail("expected the key to be refused");
}

test("a key round-trips to the identical signed lease and imports through the verified path", () => {
  const signed = lease();
  const key = serializeLicenseKey(signed);
  assert.ok(key.startsWith(LICENSE_KEY_PREFIX));
  assert.deepEqual(parseLicenseKey(key), signed);

  const env = freshEnv();
  const status = importLicenseFile(key, env, now, anchors);
  assert.equal(status.state, "valid");
  assert.equal(status.planCode, "pro");
  assert.equal(status.expiresAt, "2027-10-30T23:59:59.999Z");
});

test("pasting is whitespace, newline and prefix-case tolerant", () => {
  const signed = lease();
  const key = serializeLicenseKey(signed);
  const wrapped = `  \n${key.slice(0, 40)}\n\t${key.slice(40, 200)}\r\n  ${key.slice(200)}  \n`;
  assert.deepEqual(parseLicenseKey(wrapped), signed);
  assert.deepEqual(parseLicenseKey(`lios1-${key.slice(LICENSE_KEY_PREFIX.length)}`), signed);
});

test("the existing license file still imports unchanged, giving the same result as its key", () => {
  const signed = lease();
  const fromFile = importLicenseFile(serializeLicenseFile(signed), freshEnv(), now, anchors);
  const fromKey = importLicenseFile(serializeLicenseKey(signed), freshEnv(), now, anchors);
  assert.deepEqual(fromFile, fromKey);
});

test("damaged, truncated, oversized or malformed keys are refused with a reason a person can act on", () => {
  const key = serializeLicenseKey(lease());
  const middle = Math.floor(key.length / 2);
  const flipped = `${key.slice(0, middle)}${key[middle] === "A" ? "B" : "A"}${key.slice(middle + 1)}`;
  assert.match(refusal(() => parseLicenseKey(flipped)), /damaged when it was copied/);
  assert.match(refusal(() => parseLicenseKey(key.slice(0, key.length - 9))), /damaged|incomplete/);
  assert.match(refusal(() => parseLicenseKey(`${LICENSE_KEY_PREFIX}abc`)), /incomplete/);
  assert.match(refusal(() => parseLicenseKey(`${LICENSE_KEY_PREFIX}${"A".repeat(MAX_LICENSE_KEY_CHARS)}`)), /too long/);
  assert.match(refusal(() => parseLicenseKey(`${key.slice(0, 50)}!!${key.slice(50)}`)), /characters that are not allowed/);
  assert.match(refusal(() => parseLicenseKey("OTHER-AAAA")), /not a LiOS license key/);
  assert.match(refusal(() => importLicenseFile("hello", freshEnv(), now, anchors)), /not a LiOS licence file/);
});

test("re-encoding an edited payload (valid checksum, stale signature) is refused by the signature", () => {
  const signed = lease();
  const forged = { ...signed, payload: { ...signed.payload, expiresAt: "2099-12-31T23:59:59.999Z" } };
  const env = freshEnv();
  assert.match(refusal(() => importLicenseFile(serializeLicenseKey(forged), env, now, anchors)), /signature is not valid/);
  assert.equal(fs.existsSync(path.join(env.LIOS_LICENSE_CACHE_DIR as string, "offline-entitlement.json")), false, "a refused key stores nothing");
});

test("a key signed by a foreign signer, or an already-expired one, is refused and leaves the current license untouched", () => {
  const foreign = signer();
  const env = freshEnv();
  importLicenseFile(serializeLicenseKey(lease()), env, now, anchors);
  assert.match(refusal(() => importLicenseFile(serializeLicenseKey(lease({}, foreign)), env, now, anchors)), /not issued by a trusted LiOS licence key/);
  assert.match(refusal(() => importLicenseFile(serializeLicenseKey(lease({ expiresAt: "2026-01-01T00:00:00.000Z" })), env, now, anchors)), /expired/);
  const current = licenseStatus(env, now, anchors);
  assert.equal(current.state, "valid");
  assert.equal(current.expiresAt, "2027-10-30T23:59:59.999Z", "the previously imported key is still the one in force");
});

const CLI = path.resolve(import.meta.dirname, "../script/license_key.cjs");
const { issueKey } = createRequire(import.meta.url)(CLI);
function cli(args: string[], input: string, env: Record<string, string> = {}) {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && name !== "CI" && name !== "GITHUB_ACTIONS") clean[name] = value;
  return spawnSync(process.execPath, [CLI, ...args], { input, encoding: "utf8", env: { ...clean, ...env } });
}

test("the owner's signing CLI creates a keypair and issues keys the app itself verifies", () => {
  const generated = cli(["keygen"], "");
  assert.equal(generated.status, 0);
  assert.match(generated.stderr, /store it offline/i);
  const privatePem = /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----\n/.exec(generated.stdout)?.[0];
  const publicPem = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----\n/.exec(generated.stdout)?.[0];
  assert.ok(privatePem && publicPem);

  const expires = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const issued = cli(["issue", "--org", "12", "--license", "34", "--plan", "pro", "--expires", expires, "--features", "engine.b,engine.a"], privatePem);
  assert.equal(issued.status, 0, issued.stderr);
  const key = issued.stdout.trim();
  assert.match(key, /^LIOS1-[A-Za-z0-9_-]+$/);

  const parsed = parseLicenseKey(key);
  assert.equal(parsed.payload.organizationId, 12);
  assert.equal(parsed.payload.licenseId, 34);
  assert.equal(parsed.payload.planCode, "pro");
  assert.equal(parsed.payload.entitlementMode, "allowlist");
  assert.deepEqual(parsed.payload.featureKeys, ["engine.a", "engine.b"]);
  assert.equal(parsed.payload.deviceFingerprintHash, undefined, "keys are not device-bound");
  assert.equal(parsed.payload.expiresAt, `${expires}T23:59:59.999Z`);
  const id = licenseKeyId(publicPem);
  assert.equal(verifyLeaseAgainstTrustAnchors(parsed, { [id]: publicPem }).valid, true);

  assert.equal(importLicenseFile(key, freshEnv(), new Date(), { [id]: publicPem }).state, "valid");
  assert.match(refusal(() => importLicenseFile(key, freshEnv(), new Date(), anchors)), /trusted LiOS licence key/);
});

test("the offline issuer and app parser agree at the encoded key size boundary", () => {
  const featureKeys = Array.from({ length: 512 }, (_, index) => `engine.custom_capability_${String(index).padStart(3, "0")}`);
  const signed = lease({ entitlementMode: "allowlist", featureKeys });
  const keyForFeatures = (features: string[]) => serializeLicenseKey({
    ...signed,
    payload: { ...signed.payload, featureKeys: features },
  });
  let allowed = 0;
  let oversized = featureKeys.length;
  assert.ok(keyForFeatures(featureKeys).length > MAX_LICENSE_KEY_CHARS);
  while (oversized - allowed > 1) {
    const middle = Math.floor((allowed + oversized) / 2);
    if (keyForFeatures(featureKeys.slice(0, middle)).length <= MAX_LICENSE_KEY_CHARS) allowed = middle;
    else oversized = middle;
  }
  const boundedFeatures = featureKeys.slice(0, allowed);
  const last = boundedFeatures.length - 1;
  while (boundedFeatures[last].length < 128) {
    const nextFeatures = [...boundedFeatures];
    nextFeatures[last] += "x";
    if (keyForFeatures(nextFeatures).length > MAX_LICENSE_KEY_CHARS) break;
    boundedFeatures[last] = nextFeatures[last];
  }
  const oversizedFeatures = [...boundedFeatures];
  oversizedFeatures[last] += "x";
  assert.ok(oversizedFeatures[last].length <= 128);

  const options = {
    privateKeyPem: vendor.privatePem, organizationId: 1, licenseId: 7,
    planCode: "pro", expires: "2027-10-30", now,
  };
  const issued = issueKey({ ...options, featureKeys: boundedFeatures });
  assert.equal(issued.key.length, MAX_LICENSE_KEY_CHARS);
  const parsed = parseLicenseKey(issued.key);
  assert.deepEqual(parsed.payload.featureKeys, boundedFeatures);
  assert.equal(verifyLeaseAgainstTrustAnchors(parsed, anchors, now).valid, true);
  assert.throws(() => parseLicenseKey(keyForFeatures(oversizedFeatures)), LicenseImportError);
  assert.throws(() => issueKey({ ...options, featureKeys: oversizedFeatures }));
  assert.throws(() => issueKey({ ...options, featureKeys }));
});

test("an oversized signing request exits without emitting a key or success metadata", () => {
  const featureKeys = Array.from({ length: 512 }, (_, index) => `engine.custom_capability_${String(index).padStart(3, "0")}`);
  const expires = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const issued = cli([
    "issue", "--org", "1", "--license", "7", "--plan", "pro",
    "--expires", expires, "--features", featureKeys.join(","),
  ], vendor.privatePem);
  assert.equal(issued.status, 2);
  assert.equal(issued.stdout, "");
  assert.equal(issued.stderr.includes(vendor.privatePem), false);
  assert.equal(issued.stderr.includes(vendor.keyId), false);
});

test("the signing CLI refuses CI, argv/env private keys, bad dates and unusable stdin", () => {
  const generated = cli(["keygen"], "");
  const privatePem = /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----\n/.exec(generated.stdout)?.[0] as string;
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const issue = ["issue", "--org", "1", "--license", "1", "--plan", "pro", "--expires", expires];

  assert.notEqual(cli(["keygen"], "", { CI: "true" }).status, 0);
  const inCi = cli(issue, privatePem, { CI: "true" });
  assert.notEqual(inCi.status, 0);
  assert.equal(inCi.stdout, "");

  const viaArgv = cli([...issue, "--key", privatePem], "");
  assert.notEqual(viaArgv.status, 0);
  assert.equal(viaArgv.stdout, "");
  const viaEnv = cli(issue, "", { LIOS_PRIVATE_KEY: privatePem, PRIVATE_KEY: privatePem });
  assert.notEqual(viaEnv.status, 0, "the key is only ever read from stdin");
  assert.equal(viaEnv.stdout, "");

  assert.notEqual(cli(["issue", ...issue.slice(1, -1), "2020-01-01"], privatePem).status, 0);
  assert.notEqual(cli(["issue", ...issue.slice(1, -1), "2026-02-30"], privatePem).status, 0);
  assert.notEqual(cli(issue, "not a pem").status, 0);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.notEqual(cli(issue, rsa).status, 0, "only Ed25519 signing keys are accepted");
});
