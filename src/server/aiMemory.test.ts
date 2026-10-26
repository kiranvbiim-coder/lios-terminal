import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-ai-memory-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { runWithRequestIdentity } = await import("./requestContext");
const { stateDir } = await import("./dataRoot");
const {
  appendDurableMemory,
  correctDurableMemory,
  deleteDurableMemory,
  getDurableMemoryHistory,
  getMemoryContext,
  listDurableMemories,
} = await import("./aiMemory");
const { durableMemories, organizations, projects, users } = await import("@shared/schema");
// Turn-shaped records written through the canonical durable writer (no
// automatic Chat writer remains; this exercises storage isolation only).
const appendMemory = (entry: { ts: string; role: "user" | "assistant"; content: string }) => appendDurableMemory({
  content: entry.content,
  kind: "conversation_turn",
  role: entry.role,
  originKind: "chat_turn",
  epistemicStatus: "observed",
  observedAt: entry.ts,
});

type Identity = { userId: number | null; organizationId: number | null };
const asIdentity = <T>(identity: Identity, fn: () => T): T => runWithRequestIdentity(identity, fn);

test("GM-19 durable memory persists, isolates owners, imports legacy JSON once and enforces Project scope", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const db = getDb();
  const [org] = await db.insert(organizations).values({ name: "Memory Org", slug: "memory-org-" + Math.random().toString(36).slice(2) }).returning();
  const [owner, other, client] = await Promise.all([
    db.insert(users).values({ email: "memory-owner-" + Math.random().toString(36).slice(2) + "@example.com", passwordHash: "x", role: "internal_analyst", organizationId: null, name: "Owner" }).returning().then((rows) => rows[0]),
    db.insert(users).values({ email: "memory-other-" + Math.random().toString(36).slice(2) + "@example.com", passwordHash: "x", role: "internal_analyst", organizationId: null, name: "Other" }).returning().then((rows) => rows[0]),
    db.insert(users).values({ email: "memory-client-" + Math.random().toString(36).slice(2) + "@example.com", passwordHash: "x", role: "client_user", organizationId: org.id, name: "Client" }).returning().then((rows) => rows[0]),
  ]);

  await t.test("unauthenticated access contributes no durable memory", async () => {
    const result = await asIdentity({ userId: null, organizationId: null }, () =>
      appendMemory({ ts: new Date().toISOString(), role: "user", content: "must not persist" }),
    );
    assert.equal(result, null);
    assert.equal(await asIdentity({ userId: null, organizationId: null }, () => getMemoryContext()), "");
  });

  await t.test("user memory survives database restart and never bleeds to another owner or organization", async () => {
    await asIdentity({ userId: owner.id, organizationId: null }, async () => {
      await appendMemory({ ts: "2026-10-06T08:00:00.000Z", role: "user", content: "Owner durable fact" });
      await appendMemory({ ts: "2026-10-06T08:01:00.000Z", role: "assistant", content: "Owner durable response" });
    });
    await asIdentity({ userId: other.id, organizationId: null }, () =>
      appendMemory({ ts: "2026-10-06T08:02:00.000Z", role: "user", content: "Other private fact" }),
    );
    await asIdentity({ userId: client.id, organizationId: org.id }, () =>
      appendMemory({ ts: "2026-10-06T08:03:00.000Z", role: "user", content: "Client private fact" }),
    );

    const ownerContext = await asIdentity({ userId: owner.id, organizationId: null }, () => getMemoryContext());
    assert.match(ownerContext, /Owner durable fact/);
    assert.match(ownerContext, /Owner durable response/);
    assert.doesNotMatch(ownerContext, /Other private fact|Client private fact/);

    const rows = await getDb().select().from(durableMemories).where(eq(durableMemories.ownerUserId, owner.id));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].revision, 1);
    assert.equal(rows.find((row) => row.role === "user")?.originClass, "owner");
    assert.equal(rows.find((row) => row.role === "assistant")?.originClass, "agent");
    assert.ok(rows.every((row) => row.epistemicStatus === "observed"));

    await closeDb();
    await initDb();
    const reopened = await asIdentity({ userId: owner.id, organizationId: null }, () => getMemoryContext());
    assert.match(reopened, /Owner durable fact/);
    assert.match(reopened, /Owner durable response/);
  });

  await t.test("legacy per-user JSON is transactionally imported once and retired", async () => {
    const dbNow = getDb();
    const [legacyUser] = await dbNow.insert(users).values({
      email: "memory-legacy-" + Math.random().toString(36).slice(2) + "@example.com",
      passwordHash: "x",
      role: "internal_analyst",
      organizationId: null,
      name: "Legacy",
    }).returning();
    const legacyFile = path.join(stateDir(), "ai-memory", "internal", `user-${legacyUser.id}.json`);
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    fs.writeFileSync(legacyFile, JSON.stringify([
      { ts: "2026-09-01T10:00:00.000Z", role: "user", content: "Legacy first" },
      { ts: "2026-09-01T10:01:00.000Z", role: "assistant", content: "Legacy second" },
    ]));

    const first = await asIdentity({ userId: legacyUser.id, organizationId: null }, () => getMemoryContext());
    assert.match(first, /Legacy first/);
    assert.match(first, /Legacy second/);
    assert.equal(fs.existsSync(legacyFile), false);
    assert.equal(fs.existsSync(legacyFile + ".migrated-v1"), true);

    const imported = await getDb().select().from(durableMemories).where(and(
      eq(durableMemories.ownerUserId, legacyUser.id),
      eq(durableMemories.originKind, "legacy_ai_memory_json"),
    ));
    assert.equal(imported.length, 2);
    assert.equal(imported[0].metadata && typeof imported[0].metadata === "object" ? "legacyTimestamp" in imported[0].metadata : false, true);

    await asIdentity({ userId: legacyUser.id, organizationId: null }, () => getMemoryContext());
    const afterSecondRead = await getDb().select().from(durableMemories).where(and(
      eq(durableMemories.ownerUserId, legacyUser.id),
      eq(durableMemories.originKind, "legacy_ai_memory_json"),
    ));
    assert.equal(afterSecondRead.length, 2, "migration is idempotent");
  });

  await t.test("derived-memory dedupe keys converge repeated writes on one canonical row", async () => {
    const first = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      appendDurableMemory({
        content: "Stable derived reflection",
        kind: "reflection",
        originClass: "agent",
        originKind: "dreaming_reflection",
        epistemicStatus: "inferred",
        dedupeKey: "reflection:test:stable",
      }),
    );
    const second = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      appendDurableMemory({
        content: "A later replay must not replace the first committed reflection",
        kind: "reflection",
        originClass: "agent",
        originKind: "dreaming_reflection",
        epistemicStatus: "inferred",
        dedupeKey: "reflection:test:stable",
      }),
    );
    assert.ok(first);
    assert.ok(second);
    assert.equal(second.id, first.id);
    assert.equal(second.memoryKey, first.memoryKey);
    assert.equal(second.content, "Stable derived reflection");
    const rows = await getDb().select().from(durableMemories).where(eq(durableMemories.id, first.id));
    assert.equal(rows.length, 1);
  });

  await t.test("correction revisions are inspectable, stale writes fail closed, and delete erases remembered content", async () => {
    const [project] = await getDb().insert(projects).values({
      ownerUserId: owner.id,
      organizationId: null,
      name: "Memory Lifecycle Project",
    }).returning();

    const original = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      appendDurableMemory({
        content: "Original private lifecycle memory",
        projectId: project.id,
        kind: "project_context",
        originClass: "agent",
        originKind: "dreaming_reflection",
        epistemicStatus: "inferred",
        sourceRefs: ["source:a"],
        observedAt: "2026-10-06T08:20:00.000Z",
      }),
    );
    assert.ok(original);

    const corrected = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      correctDurableMemory({
        memoryKey: original.memoryKey,
        expectedRevision: 1,
        projectId: project.id,
        content: "Owner-corrected durable memory",
        reason: "The prior inference was incomplete.",
      }),
    );
    assert.equal(corrected.memoryKey, original.memoryKey);
    assert.equal(corrected.revision, 2);
    assert.equal(corrected.state, "active");
    assert.equal(corrected.originClass, "owner");
    assert.equal(corrected.originKind, "memory_correction");
    assert.equal(corrected.epistemicStatus, "confirmed");
    assert.match(corrected.originRef ?? "", /@r1$/);
    assert.ok(corrected.sourceRefs.includes(`${original.memoryKey}@r1`));

    const history = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      getDurableMemoryHistory({ memoryKey: original.memoryKey, projectId: project.id }),
    );
    assert.deepEqual(history.map((row) => [row.revision, row.state]), [[2, "active"], [1, "superseded"]]);
    assert.equal(history[0].content, "Owner-corrected durable memory");
    assert.equal(history[1].content, "Original private lifecycle memory");

    const context = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      getMemoryContext({ projectId: project.id, limit: 50 }),
    );
    assert.match(context, /Owner-corrected durable memory/);
    assert.doesNotMatch(context, /Original private lifecycle memory/);

    await assert.rejects(
      () => asIdentity({ userId: owner.id, organizationId: null }, () =>
        correctDurableMemory({
          memoryKey: original.memoryKey,
          expectedRevision: 1,
          projectId: project.id,
          content: "Stale overwrite",
        }),
      ),
      /revision is stale/,
    );
    await assert.rejects(
      () => asIdentity({ userId: owner.id, organizationId: null }, () =>
        deleteDurableMemory({
          memoryKey: original.memoryKey,
          expectedRevision: 1,
          projectId: project.id,
        }),
      ),
      /revision is stale/,
    );

    const tombstone = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      deleteDurableMemory({
        memoryKey: original.memoryKey,
        expectedRevision: 2,
        projectId: project.id,
        reason: "Owner requested deletion.",
      }),
    );
    assert.equal(tombstone.memoryKey, original.memoryKey);
    assert.equal(tombstone.revision, 3);
    assert.equal(tombstone.state, "deleted");
    assert.equal(tombstone.content, "[deleted]");
    assert.equal(tombstone.originKind, "memory_deletion");
    assert.equal(tombstone.sourceRefs.length, 0);
    assert.equal((tombstone.metadata as any).deletion.erasedRevisionCount, 2);
    assert.match((tombstone.metadata as any).deletion.erasedContentSha256, /^[a-f0-9]{64}$/);

    const deletedHistory = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      getDurableMemoryHistory({ memoryKey: original.memoryKey, projectId: project.id }),
    );
    assert.equal(deletedHistory.length, 1);
    assert.equal(deletedHistory[0].state, "deleted");
    assert.equal(JSON.stringify(deletedHistory).includes("Original private lifecycle memory"), false);
    assert.equal(JSON.stringify(deletedHistory).includes("Owner-corrected durable memory"), false);

    const storedRows = await getDb().select().from(durableMemories).where(eq(durableMemories.memoryKey, original.memoryKey));
    assert.equal(storedRows.length, 1);
    assert.equal(storedRows[0].state, "deleted");
    assert.equal(JSON.stringify(storedRows).includes("Original private lifecycle memory"), false);
    assert.equal(JSON.stringify(storedRows).includes("Owner-corrected durable memory"), false);

    const afterDeleteContext = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      getMemoryContext({ projectId: project.id, limit: 50 }),
    );
    assert.doesNotMatch(afterDeleteContext, /Original private lifecycle memory|Owner-corrected durable memory|\[deleted\]/);

    await closeDb();
    await initDb();
    const reopenedHistory = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      getDurableMemoryHistory({ memoryKey: original.memoryKey, projectId: project.id }),
    );
    assert.equal(reopenedHistory.length, 1);
    assert.equal(reopenedHistory[0].state, "deleted");
    const reopenedActive = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      listDurableMemories({ projectId: project.id, limit: 200 }),
    );
    assert.equal(reopenedActive.some((row) => row.memoryKey === original.memoryKey), false);
  });

  await t.test("derived-memory dedupe follows the corrected active revision and never resurrects a deleted key", async () => {
    const first = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      appendDurableMemory({
        content: "Derived memory before owner correction",
        kind: "reflection",
        originClass: "agent",
        originKind: "dreaming_reflection",
        epistemicStatus: "inferred",
        dedupeKey: "reflection:lifecycle:stable",
      }),
    );
    assert.ok(first);

    const corrected = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      correctDurableMemory({
        memoryKey: first.memoryKey,
        expectedRevision: first.revision,
        content: "Owner correction of derived memory",
      }),
    );
    const replay = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      appendDurableMemory({
        content: "Replay must resolve the corrected logical memory",
        kind: "reflection",
        originClass: "agent",
        originKind: "dreaming_reflection",
        epistemicStatus: "inferred",
        dedupeKey: "reflection:lifecycle:stable",
      }),
    );
    assert.ok(replay);
    assert.equal(replay.id, corrected.id);
    assert.equal(replay.revision, 2);
    assert.equal(replay.content, "Owner correction of derived memory");

    await asIdentity({ userId: owner.id, organizationId: null }, () =>
      deleteDurableMemory({ memoryKey: first.memoryKey, expectedRevision: 2 }),
    );
    await assert.rejects(
      () => asIdentity({ userId: owner.id, organizationId: null }, () =>
        appendDurableMemory({
          content: "Deleted reflection must not silently return",
          kind: "reflection",
          originClass: "agent",
          originKind: "dreaming_reflection",
          epistemicStatus: "inferred",
          dedupeKey: "reflection:lifecycle:stable",
        }),
      ),
      /deleted and will not be silently recreated/,
    );
  });

  await t.test("Project memory is visible only with the owned Project context", async () => {
    const [project] = await getDb().insert(projects).values({
      ownerUserId: owner.id,
      organizationId: null,
      name: "Memory Project",
    }).returning();

    await asIdentity({ userId: owner.id, organizationId: null }, () =>
      appendDurableMemory({
        content: "Project-scoped durable context",
        projectId: project.id,
        kind: "project_context",
        originClass: "owner",
        originKind: "project_chat",
        epistemicStatus: "confirmed",
        observedAt: "2026-10-06T08:10:00.000Z",
      }),
    );

    const globalOnly = await asIdentity({ userId: owner.id, organizationId: null }, () => getMemoryContext());
    assert.doesNotMatch(globalOnly, /Project-scoped durable context/);
    const projectContext = await asIdentity({ userId: owner.id, organizationId: null }, () => getMemoryContext({ projectId: project.id }));
    assert.match(projectContext, /Project-scoped durable context/);
    assert.match(projectContext, /Owner durable fact/);

    await assert.rejects(
      () => asIdentity({ userId: other.id, organizationId: null }, () =>
        appendDurableMemory({ content: "forged project memory", projectId: project.id, originKind: "test" }),
      ),
      /not owned/,
    );
    await assert.rejects(
      () => asIdentity({ userId: client.id, organizationId: org.id }, () => listDurableMemories({ projectId: project.id })),
      /not owned/,
    );
  });
});
