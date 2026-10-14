const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadOrCreateProtectedSecret, normalizeConfiguredSecret } = require("./desktopSecretCustody.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = Buffer.from(value).toString("utf8");
      if (!decoded.startsWith("protected:")) throw new Error("bad ciphertext");
      return decoded.slice("protected:".length);
    },
  };
}

test("desktop native secret custody round-trips and persists the generated master key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-secret-custody-"));
  try {
    const first = loadOrCreateProtectedSecret({
      safeStorage: fakeSafeStorage(),
      userDataPath: dir,
      isPackaged: true,
      configuredSecret: "",
      processId: 123,
    });
    assert.equal(first.mode, "native_protected");
    assert.equal(first.protectedAtRest, true);
    assert.equal(first.created, true);
    assert.ok(first.secret && first.secret.length >= 32);
    assert.equal(fs.statSync(first.secretPath).isFile(), true);

    const second = loadOrCreateProtectedSecret({
      safeStorage: fakeSafeStorage(),
      userDataPath: dir,
      isPackaged: true,
      configuredSecret: "",
      processId: 456,
    });
    assert.equal(second.mode, "native_protected");
    assert.equal(second.created, false);
    assert.equal(second.secret, first.secret);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop native secret custody never treats unavailable OS encryption as protected", () => {
  const result = loadOrCreateProtectedSecret({
    safeStorage: { isEncryptionAvailable: () => false },
    userDataPath: "/tmp/unused",
    isPackaged: true,
    configuredSecret: "",
  });
  assert.equal(result.secret, null);
  assert.equal(result.mode, "native_unavailable");
  assert.equal(result.protectedAtRest, false);
});

test("desktop native secret custody keeps unpackaged development on the existing fallback path", () => {
  const result = loadOrCreateProtectedSecret({
    safeStorage: fakeSafeStorage(),
    userDataPath: "/tmp/unused",
    isPackaged: false,
    configuredSecret: "",
  });
  assert.equal(result.secret, null);
  assert.equal(result.mode, "development_fallback");
});

test("explicit vault secret remains an override and is not misreported as OS-protected", () => {
  const result = loadOrCreateProtectedSecret({
    safeStorage: fakeSafeStorage(),
    userDataPath: "/tmp/unused",
    isPackaged: true,
    configuredSecret: "this-is-an-explicit-release-secret",
  });
  assert.equal(result.secret, "this-is-an-explicit-release-secret");
  assert.equal(result.mode, "environment_override");
  assert.equal(result.protectedAtRest, false);
});

test("configured secret validation rejects short values", () => {
  assert.equal(normalizeConfiguredSecret("short"), null);
  assert.equal(normalizeConfiguredSecret("  0123456789abcdef  "), "0123456789abcdef");
});
