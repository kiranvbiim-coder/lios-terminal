#!/usr/bin/env node
"use strict";

/**
 * Owner-only offline signing tool for LiOS license keys. Run it on a machine you control, never in CI.
 *
 *   node script/license_key.cjs keygen
 *       Prints a new Ed25519 signing keypair (PEM) to stdout. Store the PRIVATE key offline; pin the PUBLIC key
 *       in shared/licenseTrust.ts only when you decide to ship it.
 *
 *   node script/license_key.cjs issue --org <id> --license <id> --plan <code> --expires YYYY-MM-DD [--features a,b,c] < private.pem
 *       Reads the PRIVATE key PEM from stdin ONLY (never from argv, environment or a file path argument) and
 *       prints one `LIOS1-...` key to stdout. Without --features the key is unrestricted. Keys are not bound to a
 *       device; the only limit is the expiry date.
 *
 * The signed payload and key format mirror server/licenseLease.ts and server/licenseFile.ts exactly; the test in
 * server/licenseKey.test.ts verifies keys made here with the app's own verifier.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");

const LICENSE_FILE_FORMAT = "lios-license/1";
const LICENSE_KEY_PREFIX = "LIOS1-";
const LICENSE_KEY_CHECKSUM_BYTES = 4;
// Keep aligned with server/licenseFile.ts; licenseKey.test.ts exercises both sides of the boundary.
const MAX_LICENSE_KEY_CHARS = 16 * 1024;
const MAX_PRIVATE_KEY_BYTES = 8 * 1024;
const MAX_VALIDITY_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

const USAGE = `Usage:
  node script/license_key.cjs keygen
  node script/license_key.cjs issue --org <id> --license <id> --plan <code> --expires YYYY-MM-DD [--features a,b,c]  (private key PEM on stdin)`;

class UsageError extends Error {}

function pem(keyObject, type) {
  return keyObject.export({ type, format: "pem" }).toString();
}

function licenseKeyId(publicKeyPem) {
  return crypto.createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}

/** Must stay identical to canonicalPayload in server/licenseLease.ts (the cross-check test enforces it). */
function canonicalPayload(payload) {
  const canonical = {
    organizationId: payload.organizationId,
    licenseId: payload.licenseId,
    status: payload.status,
    seatsPurchased: payload.seatsPurchased,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    keyId: payload.keyId,
  };
  if (payload.planCode !== undefined) canonical.planCode = payload.planCode;
  if (payload.entitlementMode !== undefined) canonical.entitlementMode = payload.entitlementMode;
  if (payload.featureKeys !== undefined) canonical.featureKeys = [...payload.featureKeys].sort();
  return JSON.stringify(canonical);
}

function encodeLicenseKey(lease) {
  const body = Buffer.from(JSON.stringify({ format: LICENSE_FILE_FORMAT, lease }), "utf8");
  const checksum = crypto.createHash("sha256").update(LICENSE_KEY_PREFIX).update(body).digest().subarray(0, LICENSE_KEY_CHECKSUM_BYTES);
  return `${LICENSE_KEY_PREFIX}${Buffer.concat([body, checksum]).toString("base64url")}`;
}

function expiryInstant(date, now) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new UsageError("--expires must be a date like 2027-12-31.");
  const instant = new Date(`${date}T23:59:59.999Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) throw new UsageError("--expires is not a real calendar date.");
  if (instant.getTime() <= now.getTime()) throw new UsageError("--expires must be in the future.");
  if (instant.getTime() - now.getTime() > MAX_VALIDITY_DAYS * DAY_MS) throw new UsageError(`--expires may be at most ${MAX_VALIDITY_DAYS} days away.`);
  return instant;
}

function integerOption(value, name) {
  if (value === undefined || !/^\d{1,9}$/.test(value)) throw new UsageError(`${name} must be a whole number.`);
  return Number(value);
}

/** Builds and signs a key. `privateKeyPem` is the only secret input; it comes from stdin in the CLI. */
function issueKey({ privateKeyPem, organizationId, licenseId, planCode, expires, featureKeys, now = new Date() }) {
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(privateKeyPem);
  } catch {
    throw new UsageError("The private key on stdin is not a valid PEM key.");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new UsageError("The signing key must be Ed25519.");
  const keyId = licenseKeyId(pem(crypto.createPublicKey(privateKey), "spki"));
  const expiresAt = expiryInstant(expires, now);
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(planCode)) throw new UsageError("--plan must be 1-128 letters, digits, dot, dash or underscore.");
  const features = (featureKeys ?? []).map((item) => item.trim()).filter(Boolean);
  if (features.length > 512 || features.some((item) => item.length > 128)) throw new UsageError("--features has too many entries or an entry that is too long.");
  const payload = {
    organizationId,
    licenseId,
    status: "active",
    seatsPurchased: 1,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    keyId,
    planCode,
    entitlementMode: features.length ? "allowlist" : "unrestricted",
    ...(features.length ? { featureKeys: [...features].sort() } : {}),
  };
  const signature = crypto.sign(null, Buffer.from(canonicalPayload(payload), "utf8"), privateKey).toString("base64url");
  const key = encodeLicenseKey({ algorithm: "Ed25519", payload, signature });
  if (key.length > MAX_LICENSE_KEY_CHARS) throw new UsageError(`The encoded license key exceeds the app's ${MAX_LICENSE_KEY_CHARS}-character limit. Reduce the number or length of --features entries and issue it again.`);
  return { key, keyId, expiresAt: payload.expiresAt };
}

function parseIssueArgs(args) {
  const values = {};
  const allowed = { "--org": true, "--license": true, "--plan": true, "--expires": true, "--features": true };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!Object.hasOwn(allowed, name) || value === undefined || value.startsWith("--") || name in values) throw new UsageError(`Unexpected or repeated argument: ${name}`);
    values[name] = value;
  }
  for (const required of ["--org", "--license", "--plan", "--expires"]) if (!(required in values)) throw new UsageError(`Missing ${required}.`);
  return {
    organizationId: integerOption(values["--org"], "--org"),
    licenseId: integerOption(values["--license"], "--license"),
    planCode: values["--plan"],
    expires: values["--expires"],
    featureKeys: values["--features"] ? values["--features"].split(",") : [],
  };
}

function main(argv, io) {
  const [command, ...args] = argv;
  if (io.env.CI || io.env.GITHUB_ACTIONS) throw new UsageError("Refusing to run in CI: license signing is an offline, owner-only operation.");
  if (command === "keygen") {
    if (args.length) throw new UsageError("keygen takes no arguments.");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicPem = pem(publicKey, "spki");
    io.err(`WARNING: the PRIVATE key below is shown once. Store it offline (password manager / encrypted drive); anyone who has it can issue LiOS licenses.\nKey id: ${licenseKeyId(publicPem)}. Pin the public key in shared/licenseTrust.ts only when you decide to ship it.\n`);
    io.out(`${pem(privateKey, "pkcs8")}${publicPem}`);
    return 0;
  }
  if (command === "issue") {
    const options = parseIssueArgs(args);
    if (io.stdinIsTTY) throw new UsageError("Pipe the private key PEM on stdin (for example: node script/license_key.cjs issue ... < private.pem).");
    const privateKeyPem = io.readStdin();
    if (privateKeyPem.length > MAX_PRIVATE_KEY_BYTES || !privateKeyPem.trim()) throw new UsageError("No private key PEM was provided on stdin.");
    const issued = issueKey({ privateKeyPem, ...options });
    io.err(`Key id ${issued.keyId}; not device-bound; expires ${issued.expiresAt}.`);
    io.out(`${issued.key}\n`);
    return 0;
  }
  throw new UsageError(USAGE);
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2), {
      env: process.env,
      stdinIsTTY: Boolean(process.stdin.isTTY),
      readStdin: () => fs.readFileSync(0, "utf8"),
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(`${text}\n`),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

module.exports = { issueKey, encodeLicenseKey, canonicalPayload, licenseKeyId };
