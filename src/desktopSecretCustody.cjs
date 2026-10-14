const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

function normalizeConfiguredSecret(value) {
  const secret = String(value || "").trim();
  return secret.length >= 16 ? secret : null;
}

function loadOrCreateProtectedSecret(options) {
  const {
    safeStorage,
    userDataPath,
    configuredSecret,
    isPackaged,
    fileSystem = fs,
    cryptoModule = crypto,
    processId = process.pid,
  } = options;

  const override = normalizeConfiguredSecret(configuredSecret);
  if (override) {
    return {
      secret: override,
      mode: "environment_override",
      protectedAtRest: false,
      created: false,
      detail: "Vault master secret is supplied by the process environment.",
    };
  }

  if (!isPackaged) {
    return {
      secret: null,
      mode: "development_fallback",
      protectedAtRest: false,
      created: false,
      detail: "Unpackaged development uses the existing encrypted machine-derived fallback.",
    };
  }

  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== "function" || !safeStorage.isEncryptionAvailable()) {
    return {
      secret: null,
      mode: "native_unavailable",
      protectedAtRest: false,
      created: false,
      detail: "Electron safeStorage encryption is unavailable on this packaged runtime.",
    };
  }

  const secretPath = path.join(userDataPath, "vault-master-key.safe");
  fileSystem.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });

  if (fileSystem.existsSync(secretPath)) {
    const secret = safeStorage.decryptString(fileSystem.readFileSync(secretPath));
    if (!secret || secret.length < 32) throw new Error("Stored vault master secret is invalid.");
    return {
      secret,
      mode: "native_protected",
      protectedAtRest: true,
      created: false,
      detail: "Existing vault master secret was recovered through Electron safeStorage.",
      secretPath,
    };
  }

  const secret = cryptoModule.randomBytes(32).toString("base64url");
  const encrypted = safeStorage.encryptString(secret);
  if (!encrypted || encrypted.length === 0) throw new Error("Electron safeStorage returned an empty encrypted secret.");

  const tempPath = `${secretPath}.tmp-${processId}`;
  fileSystem.writeFileSync(tempPath, encrypted, { mode: 0o600 });
  fileSystem.renameSync(tempPath, secretPath);
  try { fileSystem.chmodSync(secretPath, 0o600); } catch { /* Windows ACLs are not chmod-based. */ }

  const roundTrip = safeStorage.decryptString(fileSystem.readFileSync(secretPath));
  if (roundTrip !== secret) {
    try { fileSystem.rmSync(secretPath, { force: true }); } catch { /* best effort */ }
    throw new Error("Electron safeStorage round-trip verification failed.");
  }

  return {
    secret,
    mode: "native_protected",
    protectedAtRest: true,
    created: true,
    detail: "A new vault master secret was generated and round-trip verified through Electron safeStorage.",
    secretPath,
  };
}

module.exports = {
  loadOrCreateProtectedSecret,
  normalizeConfiguredSecret,
};
