import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-provider-access-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const {
  providerAccessTool,
  providerAccessToolInputSchema,
  providerAccessToolOutputSchema,
} = await import("./providerAccessTool");

test("SI-03.23 provider access inspection is deterministic, Project-scoped and credential-safe", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner, other] = await Promise.all([
    getDb().insert(users).values({
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "test-hash",
      role: "internal_analyst",
      name: "Provider access owner",
    }).returning().then((rows) => rows[0]),
    getDb().insert(users).values({
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "test-hash",
      role: "internal_analyst",
      name: "Other owner",
    }).returning().then((rows) => rows[0]),
  ]);
  const project = await createProject(
    { userId: owner.id, organizationId: null, role: owner.role },
    { name: "Provider Access Research" },
  );

  const call = {
    source: "agent" as const,
    userId: owner.id,
    tenant: { userId: owner.id, organizationId: null, role: "internal_analyst" as const },
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "auto" as const,
  };

  await t.test("descriptor is safe-auto read-only and model input cannot smuggle tenant or credentials", () => {
    assert.equal(providerAccessTool.permissionClass, "safe_auto");
    assert.equal(providerAccessTool.access, "read");
    assert.equal(providerAccessTool.sideEffect, "none");
    assert.equal(providerAccessTool.replaySafe, true);
    assert.equal(providerAccessToolInputSchema.safeParse({ capability: "security_resolution" }).success, true);
    assert.equal(providerAccessToolInputSchema.safeParse({
      capability: "security_resolution",
      credentialRef: "vault:secret",
    }).success, false);
    assert.equal(providerAccessToolInputSchema.safeParse({
      capability: "security_resolution",
      tenant: { userId: 999 },
    }).success, false);
  });

  await t.test("local canonical provider exposes explicit locality/auth while secret material stays absent", async () => {
    const result = providerAccessToolOutputSchema.parse(await providerAccessTool.invoke(
      { capability: "security_resolution", pointInTimeMode: "latest" },
      new AbortController().signal,
      call,
    ));
    const instrumentMaster = result.output.providers.find((item) => item.providerId === "lios.instrument-master");
    assert.ok(instrumentMaster);
    assert.equal(instrumentMaster.authentication.mode, "local_state");
    assert.equal(instrumentMaster.authentication.credentialRequirement, "not_required");
    assert.equal(instrumentMaster.authentication.secretMaterialExposed, false);
    assert.equal(instrumentMaster.locality, "lios_local");
    assert.equal(instrumentMaster.entitlement.decision, "unknown", "inspection must not execute entitlement hooks");
    assert.equal(instrumentMaster.availability.reason, "not_evaluated");
    assert.equal(result.output.dataFetchPerformed, false);
    assert.equal(result.output.secretMaterialExposed, false);
    assert.equal(/credentialRef|api[_-]?key|password|token/i.test(JSON.stringify(result)), false);
  });

  await t.test("provider allow/deny narrowing is deterministic and performs no data fetch", async () => {
    const result = providerAccessToolOutputSchema.parse(await providerAccessTool.invoke(
      {
        capability: "security_resolution",
        providerAllow: ["lios.instrument-master"],
        providerDeny: ["other"],
      },
      new AbortController().signal,
      call,
    ));
    assert.deepEqual(result.output.providers.map((item) => item.providerId), ["lios.instrument-master"]);
    assert.equal(result.output.dataFetchPerformed, false);

    const excluded = providerAccessToolOutputSchema.parse(await providerAccessTool.invoke(
      {
        capability: "security_resolution",
        providerAllow: ["not-a-real-provider"],
      },
      new AbortController().signal,
      call,
    ));
    assert.equal(excluded.output.providerCount, 0);
    assert.deepEqual(excluded.output.providers, []);
    assert.match(excluded.summary, /No provider metadata remains/);
  });

  await t.test("Project ownership is enforced before provider metadata is returned", async () => {
    await assert.rejects(
      () => providerAccessTool.invoke(
        { capability: "security_resolution" },
        new AbortController().signal,
        {
          ...call,
          userId: other.id,
          tenant: { userId: other.id, organizationId: null, role: "internal_analyst" as const },
        },
      ),
      /not owned|does not exist|not found/i,
    );
  });
});
