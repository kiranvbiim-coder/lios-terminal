"use strict";
const crypto = require("node:crypto");

const DOMAIN = "lios/native-artifact-draft-recovery/v1";
const MAX_LIFETIME_MS = 2 * 60_000;
function checkScope(input) {
  const owner = typeof input?.owner === "string" ? input.owner.trim().toLowerCase() : "";
  if (!owner || owner.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)
    || typeof input.artifactId !== "string" || !/^(?:artifact:)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.artifactId)
    || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 1
    || typeof input.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(input.contentHash)) {
    throw new Error("Native draft grant scope is invalid.");
  }
  return { owner, artifactId: input.artifactId, baseVersion: input.baseVersion, contentHash: input.contentHash.toLowerCase() };
}

function issueNativeDraftGrant(secret, input, now = Date.now()) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Desktop grant signing is unavailable.");
  const scope = checkScope(input);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Desktop grant timestamp is invalid.");
  const encoded = Buffer.from(JSON.stringify({ version: 1, ...scope, expiresAt: now + MAX_LIFETIME_MS }), "utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(DOMAIN + "." + encoded).digest("base64url");
  return encoded + "." + mac;
}

function verifyNativeDraftGrant(secret, token, input, now = Date.now()) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Desktop grant verification is unavailable.");
  if (typeof token !== "string" || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Native draft grant is missing or malformed.");
  }
  const [encoded, macText] = token.split(".");
  const mac = Buffer.from(macText, "base64url");
  const expected = crypto.createHmac("sha256", secret).update(DOMAIN + "." + encoded).digest();
  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) {
    throw new Error("Native draft grant is not authorized.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const scope = checkScope(input);
  if (payload?.version !== 1 || !Number.isSafeInteger(payload.expiresAt)
    || !Number.isSafeInteger(now) || payload.expiresAt <= now
    || payload.expiresAt > now + MAX_LIFETIME_MS
    || payload.owner !== scope.owner || payload.artifactId !== scope.artifactId
    || payload.baseVersion !== scope.baseVersion || payload.contentHash !== scope.contentHash) {
    throw new Error("Native draft grant expired or does not match authenticated Artifact scope.");
  }
  return scope;
}
module.exports = { issueNativeDraftGrant, verifyNativeDraftGrant, MAX_LIFETIME_MS };
