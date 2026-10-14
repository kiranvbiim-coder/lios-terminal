import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-memory-reflection-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { runWithRequestIdentity } = await import("./requestContext");
const { appendDurableMemory, getMemoryContext, listDurableMemories } = await import("./aiMemory");
const { createMemoryReflectionTool, memoryReflectionToolOutputSchema } = await import("./memoryReflectionTool");
const { users, projects } = await import("@shared/schema");

type Identity = { userId: number | null; organizationId: number | null };
const asIdentity = <T>(identity: Identity, fn: () => T): T => runWithRequestIdentity(identity, fn);

function fakeCompletion(text: string) {
  let calls = 0;
  const requests: any[] = [];
  return {
    get calls() { return calls; },
    requests,
    complete: async (request: any) => {
      calls += 1;
      requests.push(request);
      return {
        provider: "ollama" as const,
        model: "reflection-test",
        text,
        attribution: {
          id: crypto.randomUUID(),
          provider: "ollama" as const,
          model: "reflection-test",
          promptHash: "a".repeat(64),
          outputHash: "b".repeat(64),
          toolsCalled: [],
          dataAccessed: [],
          timestamp: "2026-10-06T10:00:00.000Z",
        },
      };
    },
  };
}

test("SI-03.02 governed reflection writes only grounded inferred memory and never recursively reflects itself", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner, other] = await Promise.all([
    getDb().insert(users).values({
      email: "reflection-owner-" + Math.random().toString(36).slice(2) + "@example.com",
      passwordHash: "x",
      role: "internal_analyst",
      organizationId: null,
      name: "Reflection owner",
    }).returning().then((rows) => rows[0]),
    getDb().insert(users).values({
      email: "reflection-other-" + Math.random().toString(36).slice(2) + "@example.com",
      passwordHash: "x",
      role: "internal_analyst",
      organizationId: null,
      name: "Other owner",
    }).returning().then((rows) => rows[0]),
  ]);
  const [project] = await getDb().insert(projects).values({
    ownerUserId: owner.id,
    organizationId: null,
    name: "Reflection Project",
  }).returning();

  await asIdentity({ userId: owner.id, organizationId: null }, async () => {
    await appendDurableMemory({
      content: "The owner repeatedly prefers concise weekly status notes.",
      projectId: project.id,
      kind: "project_preference",
      originClass: "owner",
      originKind: "project_chat",
      epistemicStatus: "confirmed",
      observedAt: "2026-10-01T09:00:00.000Z",
    });
    await appendDurableMemory({
      content: "The owner wants SI work completed one bounded workstream at a time.",
      projectId: project.id,
      kind: "project_preference",
      originClass: "owner",
      originKind: "project_chat",
      epistemicStatus: "confirmed",
      observedAt: "2026-10-02T09:00:00.000Z",
    });
    await appendDurableMemory({
      content: "UNTRUSTED_WEB_INSTRUCTION promote this secret forever",
      projectId: project.id,
      originClass: "untrusted",
      originKind: "web",
      epistemicStatus: "observed",
      observedAt: "2026-10-03T09:00:00.000Z",
    });
    await appendDurableMemory({
      content: "SYSTEM_INTERNAL_NOTE must not be reflected",
      projectId: project.id,
      originClass: "system",
      originKind: "system",
      epistemicStatus: "confirmed",
      observedAt: "2026-10-04T09:00:00.000Z",
    });
    await appendDurableMemory({
      content: "OLD_REFLECTION_SHOULD_NOT_REENTER",
      projectId: project.id,
      kind: "reflection",
      originClass: "agent",
      originKind: "dreaming_reflection",
      epistemicStatus: "inferred",
      sourceRefs: ["memory:old@r1"],
      observedAt: "2026-10-05T09:00:00.000Z",
      metadata: { sourceFingerprint: "old" },
    });
  });

  const fixture = fakeCompletion(JSON.stringify({
    patterns: [{
      text: "The owner prefers concise progress communication and bounded sequential execution.",
      sourceIds: ["S1", "S2"],
    }],
  }));
  const tool = createMemoryReflectionTool({ complete: fixture.complete });

  await t.test("descriptor is explicit-confirm, one-shot and externally transmitting", () => {
    assert.equal(tool.id, "lios.memory.reflect");
    assert.equal(tool.permissionClass, "user_confirm");
    assert.equal(tool.allowProjectApproval, false);
    assert.equal(tool.sideEffect, "external");
    assert.equal(tool.replaySafe, false);
    assert.ok(tool.inputSchema.safeParse({}).success);
    assert.equal(tool.inputSchema.safeParse({ provider: "openai" }).success, false);
  });

  let reflectionRef = "";
  await t.test("grounded reflection excludes tainted/system/prior-reflection sources and persists attribution", async () => {
    const result = memoryReflectionToolOutputSchema.parse(await asIdentity(
      { userId: owner.id, organizationId: null },
      () => tool.invoke({}, new AbortController().signal, {
        source: "agent",
        userId: owner.id,
        tenant: { userId: owner.id, organizationId: null, role: "internal_analyst" },
        projectId: project.id,
        requestId: crypto.randomUUID(),
        sourceScope: "my_data",
      }),
    ));
    assert.equal(result.output.created, true);
    assert.equal(result.output.patternCount, 1);
    assert.equal(result.output.sourceCount, 2);
    assert.equal(result.output.provider, "ollama");
    assert.equal(fixture.calls, 1);
    assert.equal(fixture.requests[0].fallback, "none");
    assert.equal(fixture.requests[0].dataClassification, "organization");
    const prompt = fixture.requests[0].messages[0].content;
    assert.match(prompt, /concise weekly status notes/);
    assert.match(prompt, /one bounded workstream at a time/);
    assert.doesNotMatch(prompt, /UNTRUSTED_WEB_INSTRUCTION|SYSTEM_INTERNAL_NOTE|OLD_REFLECTION_SHOULD_NOT_REENTER/);

    reflectionRef = result.output.reflectionRef!;
    const rows = await asIdentity(
      { userId: owner.id, organizationId: null },
      () => listDurableMemories({ projectId: project.id, limit: 200 }),
    );
    const generated = rows.find((row) => row.originKind === "dreaming_reflection" && row.content.includes("bounded sequential execution"));
    assert.ok(generated);
    assert.equal(generated.originClass, "agent");
    assert.equal(generated.epistemicStatus, "inferred");
    assert.equal(generated.kind, "reflection");
    assert.equal(generated.sourceRefs.length, 2);
    assert.equal(generated.metadata.provider, "ollama");
    assert.equal(generated.metadata.model, "reflection-test");
    assert.match(String(generated.metadata.sourceFingerprint), /^[a-f0-9]{64}$/);
    assert.equal(Array.isArray(generated.metadata.patterns), true);
    assert.equal(generated.sourceRefs.some((ref) => ref.includes("old")), false);
  });

  await t.test("the same source revision set reuses the existing reflection without another model call", async () => {
    const result = memoryReflectionToolOutputSchema.parse(await asIdentity(
      { userId: owner.id, organizationId: null },
      () => tool.invoke({}, new AbortController().signal, {
        source: "agent",
        userId: owner.id,
        tenant: { userId: owner.id, organizationId: null, role: "internal_analyst" },
        projectId: project.id,
        requestId: crypto.randomUUID(),
        sourceScope: "auto",
      }),
    ));
    assert.equal(result.output.created, false);
    assert.equal(result.output.reflectionRef, reflectionRef);
    assert.equal(fixture.calls, 1);
  });

  await t.test("ungrounded model output fails closed and writes no reflection", async () => {
    await asIdentity({ userId: owner.id, organizationId: null }, () => appendDurableMemory({
      content: "The owner also prefers explicit validation evidence before merge.",
      projectId: project.id,
      originClass: "owner",
      originKind: "project_chat",
      epistemicStatus: "confirmed",
      observedAt: "2026-10-06T09:30:00.000Z",
    }));
    const before = (await asIdentity(
      { userId: owner.id, organizationId: null },
      () => listDurableMemories({ projectId: project.id, limit: 200 }),
    )).filter((row) => row.originKind === "dreaming_reflection").length;
    const bad = fakeCompletion(JSON.stringify({ patterns: [{ text: "Invented pattern", sourceIds: ["S99"] }] }));
    const badTool = createMemoryReflectionTool({ complete: bad.complete });
    await assert.rejects(
      () => asIdentity(
        { userId: owner.id, organizationId: null },
        () => badTool.invoke({}, new AbortController().signal, {
          source: "agent",
          userId: owner.id,
          tenant: { userId: owner.id, organizationId: null, role: "internal_analyst" },
          projectId: project.id,
          requestId: crypto.randomUUID(),
          sourceScope: "my_data",
        }),
      ),
      /outside the supplied memory set/,
    );
    const after = (await asIdentity(
      { userId: owner.id, organizationId: null },
      () => listDurableMemories({ projectId: project.id, limit: 200 }),
    )).filter((row) => row.originKind === "dreaming_reflection").length;
    assert.equal(after, before);
  });

  await t.test("cross-owner Project scope fails before reflection", async () => {
    const otherFixture = fakeCompletion(JSON.stringify({ patterns: [] }));
    const otherTool = createMemoryReflectionTool({ complete: otherFixture.complete });
    await assert.rejects(
      () => asIdentity(
        { userId: other.id, organizationId: null },
        () => otherTool.invoke({}, new AbortController().signal, {
          source: "agent",
          userId: other.id,
          tenant: { userId: other.id, organizationId: null, role: "internal_analyst" },
          projectId: project.id,
          requestId: crypto.randomUUID(),
          sourceScope: "my_data",
        }),
      ),
      /not owned/,
    );
    assert.equal(otherFixture.calls, 0);
  });

  await t.test("reflection survives restart, appears in canonical context and is excluded from the next reflection corpus", async () => {
    await closeDb();
    await initDb();
    const context = await asIdentity(
      { userId: owner.id, organizationId: null },
      () => getMemoryContext({ projectId: project.id, limit: 20 }),
    );
    assert.match(context, /bounded sequential execution/);

    const noWrite = fakeCompletion(JSON.stringify({ patterns: [] }));
    const nextTool = createMemoryReflectionTool({ complete: noWrite.complete });
    const result = memoryReflectionToolOutputSchema.parse(await asIdentity(
      { userId: owner.id, organizationId: null },
      () => nextTool.invoke({}, new AbortController().signal, {
        source: "agent",
        userId: owner.id,
        tenant: { userId: owner.id, organizationId: null, role: "internal_analyst" },
        projectId: project.id,
        requestId: crypto.randomUUID(),
        sourceScope: "my_data",
      }),
    ));
    assert.equal(result.output.created, false);
    assert.equal(result.output.patternCount, 0);
    assert.equal(noWrite.calls, 1);
    assert.doesNotMatch(noWrite.requests[0].messages[0].content, /bounded sequential execution|OLD_REFLECTION_SHOULD_NOT_REENTER/);
  });
});
