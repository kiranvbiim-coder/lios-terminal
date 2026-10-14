import assert from "node:assert/strict";
import test from "node:test";
import { runtimeComponentKindSchema } from "@shared/runtimeContracts";
import { HOME_PROVIDER_SLOTS } from "@shared/runtimeProviderContracts";
import { createRuntimeFoundationRegistry, createRuntimeFoundationSnapshot } from "./runtimeFoundation";
import { HOME_PROVIDER_SPECS, createHomeRuntimeSnapshot, homeProviderDescriptors, resolveActiveHomeProfile } from "./runtimeProviders";

const codes = (env: NodeJS.ProcessEnv) => createHomeRuntimeSnapshot(env).conformance.issues.map((issue) => `${issue.slot}:${issue.code}`);

test("a default desktop process is Desktop Local on PGlite and conforms to the zero-LiOS-server rule", () => {
  const snapshot = createHomeRuntimeSnapshot({});
  assert.equal(snapshot.mode, "desktop_local");
  assert.equal(snapshot.profile.database, "lios.database.pglite");
  assert.equal(snapshot.profile.network, "lios.network.loopback");
  assert.equal(snapshot.profile.identity, "lios.identity.local-session");
  assert.equal(snapshot.profile.license, "lios.license.signed-offline-lease");
  assert.deepEqual(snapshot.profile.secrets, ["lios.secrets.env", "lios.secrets.local-vault"]);
  assert.equal(snapshot.profile.notification, null);
  assert.equal(snapshot.conformance.conformant, true, JSON.stringify(snapshot.conformance.issues));
});

test("a user-managed PostgreSQL keeps credentials in the local vault unless the organization store is chosen explicitly", () => {
  const url = "postgres://owner:s3cret@db.example.net/lios";
  const implicit = createHomeRuntimeSnapshot({ DATABASE_URL: url });
  assert.equal(implicit.profile.database, "lios.database.postgres");
  assert.deepEqual(implicit.profile.secrets, ["lios.secrets.env", "lios.secrets.local-vault"]);
  assert.equal(implicit.profile.backup.includes("lios.backup.pglite-snapshot"), false);
  assert.equal(implicit.conformance.conformant, true);
  const chosen = createHomeRuntimeSnapshot({ DATABASE_URL: url, LIMURIA_CREDENTIAL_STORE: "organization" });
  assert.deepEqual(chosen.profile.secrets, ["lios.secrets.env", "lios.secrets.organization-vault"]);
});

test("a server Home binds a user-selected address, keeps the portable archive and loses the desktop-only workspace backup", () => {
  const profile = resolveActiveHomeProfile({ HOST: "0.0.0.0" });
  assert.equal(profile.mode, "user_home_server");
  assert.equal(profile.network, "lios.network.user-bind");
  assert.deepEqual(profile.backup, ["lios.backup.portable-archive", "lios.backup.pglite-snapshot"]);
});

test("a server Home on a user PostgreSQL is covered by the portable archive backup", () => {
  assert.deepEqual(codes({ HOST: "0.0.0.0", DATABASE_URL: "postgres://u:p@db/lios" }), []);
});

test("provider specs are unique, kind-correct and declare operator and supported modes", () => {
  const ids = HOME_PROVIDER_SPECS.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const descriptor of homeProviderDescriptors()) {
    assert.ok(descriptor.capabilities.some((tag) => tag.startsWith("mode:")), `${descriptor.id} declares no mode`);
    assert.equal(descriptor.capabilities.filter((tag) => tag.startsWith("operator:")).length, 1, `${descriptor.id} must declare exactly one operator`);
  }
  for (const kind of Object.values(HOME_PROVIDER_SLOTS)) assert.ok(runtimeComponentKindSchema.options.includes(kind));
});

test("the runtime foundation exposes providers through the existing registry with process-derived health", async () => {
  const saved = { db: process.env.DATABASE_URL, secret: process.env.LIMURIA_VAULT_SECRET, host: process.env.HOST };
  try {
    delete process.env.DATABASE_URL; delete process.env.HOST;
    delete process.env.LIMURIA_VAULT_SECRET;
    const registry = createRuntimeFoundationRegistry();
    for (const kind of Object.values(HOME_PROVIDER_SLOTS).filter((kind) => kind !== "notification_provider")) {
      assert.ok(registry.list(kind).length > 0, `no ${kind} registered`);
    }
    assert.equal(registry.list("notification_provider").length, 0, "no notification provider ships yet");
    const health = new Map((await registry.healthSnapshot()).map((entry) => [entry.componentId, entry]));
    assert.equal(health.get("lios.identity.local-session")?.state, "available");
    assert.equal(health.get("lios.database.pglite")?.state, "available");
    assert.equal(health.get("lios.secrets.local-vault")?.state, "available");
    assert.match(health.get("lios.secrets.local-vault")?.detail ?? "", /random key stored beside the vault/, "the file-permission-only protection must be stated");
    process.env.LIMURIA_VAULT_SECRET = "a-sufficiently-long-os-protected-secret";
    const protectedHealth = (await createRuntimeFoundationRegistry().healthSnapshot()).find((entry) => entry.componentId === "lios.secrets.local-vault");
    assert.equal(protectedHealth?.state, "available");
    assert.match(protectedHealth?.detail ?? "", /OS-protected desktop secret or the operator/);
  } finally {
    for (const [key, value] of [["DATABASE_URL", saved.db], ["LIMURIA_VAULT_SECRET", saved.secret], ["HOST", saved.host]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("the snapshot and health payloads never contain connection strings, secrets or URLs from the environment", async () => {
  const saved = { db: process.env.DATABASE_URL, secret: process.env.LIMURIA_VAULT_SECRET };
  try {
    process.env.DATABASE_URL = "postgres://owner:hunter2-pass@db.private.example/lios";
    process.env.LIMURIA_VAULT_SECRET = "vault-secret-value-1234567890";
    const text = JSON.stringify(createRuntimeFoundationSnapshot()) + JSON.stringify(await createRuntimeFoundationRegistry().healthSnapshot());
    for (const leak of ["hunter2-pass", "db.private.example", "vault-secret-value-1234567890"]) {
      assert.equal(text.includes(leak), false, `leaked ${leak}`);
    }
  } finally {
    for (const [key, value] of [["DATABASE_URL", saved.db], ["LIMURIA_VAULT_SECRET", saved.secret]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
