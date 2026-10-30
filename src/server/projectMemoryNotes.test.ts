import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { ProjectMemoryNote, ProjectMemoryNoteList } from "@shared/projectMemoryNotes";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-owner-note-http-"));
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// Data-root selection occurs during module loading; imports must follow the isolated environment setup.
const { initDb, getDb, closeDb } = await import("./db");
const { users, organizations, durableMemories, userDataConsents } = await import("@shared/schema");
const { createProject, archiveProject, trashProject } = await import("./projectStore");
const { appendDurableMemory, correctDurableMemory, deleteDurableMemory, DurableMemoryMutationError } = await import("./aiMemory");
const { registerProjectRoutes } = await import("./projectRoutes");
const { runWithRequestIdentity, getRequestIdentity } = await import("./requestContext");
const { createProjectMemoryNote } = await import("./projectMemoryNotes");
const { prepareProjectMemoryRecall, projectMemoryRecallConsent, setProjectMemoryRecallConsent } = await import("./projectMemoryRecall");

test("explicit Project owner notes use canonical revisions, strict HTTP scope, opt-in recall and persistent deletion", { timeout: 90_000 }, async t => {
  await initDb();
  const server = createServer();
  t.after(async () => {
    if (server.listening) {
      const closed = Promise.withResolvers<void>();
      server.close(error => error ? closed.reject(error) : closed.resolve());
      await closed.promise;
    }
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [org, secondOrg] = await getDb().insert(organizations).values([
    { name: "Notes tenant", slug: crypto.randomUUID() }, { name: "Other tenant", slug: crypto.randomUUID() },
  ]).returning();
  const [owner, foreign, client] = await getDb().insert(users).values([
    { name: "Owner", email: `${crypto.randomUUID()}@example.invalid`, passwordHash: "synthetic", role: "internal_admin" as const },
    { name: "Foreign", email: `${crypto.randomUUID()}@example.invalid`, passwordHash: "synthetic", role: "internal_admin" as const },
    { name: "Tenant", email: `${crypto.randomUUID()}@example.invalid`, passwordHash: "synthetic", role: "client_admin" as const, organizationId: org.id },
  ]).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const clientCtx = { userId: client.id, organizationId: org.id, role: client.role };
  const project = await createProject(ctx, { name: "Fresh explicit notes" });
  const otherProject = await createProject(ctx, { name: "Other Project" });
  const clientProject = await createProject(clientCtx, { name: "Tenant Project" });
  const app = express();
  app.use(express.json());
  // Intentionally omit request AsyncLocalStorage: routes must bind canonical owner identity themselves.
  // Retain this cached authenticated user so account-currentness checks are exercised independently.
  app.use((req, _res, next) => {
    const user = [owner, foreign, client].find(candidate => String(candidate.id) === req.header("x-test-user-id"));
    req.isAuthenticated = (() => Boolean(user)) as typeof req.isAuthenticated;
    if (user) req.user = user;
    next();
  });
  registerProjectRoutes(app);
  server.on("request", app);
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const collection = (id = project.id) => `/api/projects/${id}/memory-notes`;
  const request = (url: string, method = "GET", body?: unknown, userId: number | null = owner.id) => fetch(base + url, {
    method, headers: { "content-type": "application/json", ...(userId === null ? {} : { "x-test-user-id": String(userId) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const save = async (content: string, id = project.id, userId = owner.id): Promise<ProjectMemoryNote> => {
    const response = await request(collection(id), "POST", { content, reviewed: true }, userId);
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json() as { note: ProjectMemoryNote }).note;
  };
  const item = (note: ProjectMemoryNote, id = project.id) => `${collection(id)}/${encodeURIComponent(note.memoryKey)}`;

  assert.equal((await request(collection(), "GET", undefined, null)).status, 401);
  assert.deepEqual(await (await request(collection())).json(), { notes: [], nextCursor: null });
  for (const body of [{ content: "not reviewed" }, { content: "not reviewed", reviewed: false },
    { content: "reviewed", reviewed: true, originClass: "owner" },
    { content: "reviewed", reviewed: true, sourceRefs: [] },
    { content: "reviewed", reviewed: true, ownerUserId: foreign.id },
    { content: "reviewed", reviewed: true, projectId: otherProject.id },
    { content: "reviewed", reviewed: true, organizationId: org.id },
    { content: "reviewed", reviewed: true, metadata: { originKind: "explicit_owner_note" } },
    { content: "reviewed", reviewed: true, memoryRecall: true },
    { content: " ", reviewed: true }, { content: "x".repeat(4001), reviewed: true }, { content: "bad\u0000text", reviewed: true }]) {
    assert.equal((await request(collection(), "POST", body)).status, 400);
  }
  const original = await save("Revenue baseline explicitly reviewed by owner");
  assert.equal(original.revision, 1);
  const [stored] = await getDb().select().from(durableMemories).where(eq(durableMemories.memoryKey, original.memoryKey));
  assert.equal(stored.ownerUserId, owner.id);
  assert.equal(stored.projectId, project.id);
  assert.equal(stored.organizationId, null);
  assert.deepEqual([stored.kind, stored.role, stored.originClass, stored.originKind, stored.epistemicStatus],
    ["owner_note", "user", "owner", "explicit_owner_note", "confirmed"]);
  assert.deepEqual(stored.sourceRefs, []);
  assert.equal((await projectMemoryRecallConsent(ctx, project.id)).enabled, false);
  assert.equal(await prepareProjectMemoryRecall(ctx, project.id, "Revenue"), null);
  assert.equal((await getDb().select().from(userDataConsents).where(eq(userDataConsents.userId, owner.id))).length, 0);
  assert.equal((await request(collection(), "GET", undefined, foreign.id)).status, 404);
  assert.equal((await request(collection(), "POST", { content: "foreign", reviewed: true }, foreign.id)).status, 404);

  const other = await save("Other Project private note", otherProject.id);
  const tenant = await save("Tenant private note", clientProject.id, client.id);
  const derived = await runWithRequestIdentity(ctx, () => appendDurableMemory({ projectId: project.id,
    content: "derived root", kind: "owner_note", role: "user", originClass: "agent", originKind: "reflection" }));
  assert.ok(derived);
  await runWithRequestIdentity(ctx, () => correctDurableMemory({ memoryKey: derived.memoryKey, projectId: project.id, expectedRevision: 1, content: "owner-corrected derived root" }));
  const global = await runWithRequestIdentity(ctx, () => appendDurableMemory({ content: "Global private note", kind: "owner_note", role: "user",
    originClass: "owner", originKind: "explicit_owner_note", epistemicStatus: "confirmed" }));
  assert.ok(global);
  // More irrelevant rows than the old bounded memory list: exact SQL selection must not starve owner notes.
  await getDb().insert(durableMemories).values(Array.from({ length: 105 }, (_, i) => ({
    id: `fixture:${crypto.randomUUID()}`, memoryKey: `aaa:irrelevant:${i}`, ownerUserId: owner.id,
    organizationId: null, projectId: project.id, scope: "project" as const, kind: "reflection", role: "assistant",
    content: "Unrelated derived memory", originClass: "agent" as const, originKind: "reflection",
  })));
  // Even matching explicit metadata cannot cross the current head's tenant boundary.
  const wrongOrg = { ...stored, id: `fixture:${crypto.randomUUID()}`, memoryKey: `memory:${crypto.randomUUID()}`, organizationId: secondOrg.id };
  const wrongOwner = { ...stored, id: `fixture:${crypto.randomUUID()}`, memoryKey: `memory:${crypto.randomUUID()}`, ownerUserId: foreign.id };
  await getDb().insert(durableMemories).values([wrongOrg, wrongOwner]);
  for (const key of [other.memoryKey, tenant.memoryKey, derived.memoryKey, global.memoryKey, wrongOrg.memoryKey, wrongOwner.memoryKey]) {
    for (const method of ["PATCH", "DELETE"]) {
      const body = method === "PATCH" ? { content: "must not edit", expectedRevision: 1, reviewed: true } : { expectedRevision: 1, reviewed: true };
      assert.equal((await request(`${collection()}/${encodeURIComponent(key)}`, method, body)).status, 404);
    }
  }
  assert.deepEqual((await (await request(collection())).json() as ProjectMemoryNoteList).notes.map(row => row.memoryKey), [original.memoryKey]);
  for (let i = 0; i < 23; i++) await save(`Pagination note ${i}`);
  const keys: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await request(`${collection()}?limit=7${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(response.status, 200);
    const page = await response.json() as ProjectMemoryNoteList;
    assert.ok(page.notes.length <= 7);
    keys.push(...page.notes.map(row => row.memoryKey));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(keys.length, 24);
  assert.deepEqual(keys, [...new Set(keys)].sort());
  for (const query of ["limit=0", "limit=51", "limit=1.5", "after=", "after=x&after=y"]) {
    assert.equal((await request(`${collection()}?${query}`)).status, 400);
  }

  await setProjectMemoryRecallConsent(ctx, project.id, true);
  const beforeEdit = await prepareProjectMemoryRecall(ctx, project.id, "Revenue");
  assert.ok(beforeEdit);
  const races = await Promise.all(["first", "second"].map(content => request(item(original), "PATCH", {
    content: `Revenue ${content} correction`, expectedRevision: 1, reviewed: true,
  })));
  assert.deepEqual(races.map(response => response.status).sort(), [200, 409]);
  const winner = races.find(response => response.status === 200)!;
  const edited = (await winner.json() as { note: ProjectMemoryNote }).note;
  assert.equal(edited.revision, 2);
  assert.equal(edited.memoryKey, original.memoryKey);
  assert.equal(edited.createdAt, original.createdAt);
  await assert.rejects(beforeEdit.assertCurrent());
  const history = await getDb().select().from(durableMemories).where(eq(durableMemories.memoryKey, original.memoryKey));
  assert.equal(history.length, 2);
  const correction = history.find(row => row.revision === 2)!;
  assert.equal(correction.originKind, "memory_correction");
  assert.deepEqual(correction.sourceRefs, [`${original.memoryKey}@r1`]);
  for (const method of ["PATCH", "DELETE"]) {
    const stale = await request(item(original), method, { expectedRevision: 1, reviewed: true, ...(method === "PATCH" ? { content: "stale" } : {}) });
    assert.equal(stale.status, 409);
    assert.equal((await request(item(original), method, { expectedRevision: 2, reviewed: true, originKind: "forged", ...(method === "PATCH" ? { content: "forged" } : {}) })).status, 400);
  }
  const prepared = await prepareProjectMemoryRecall(ctx, project.id, "Revenue");
  assert.ok(prepared);
  assert.equal((await request(item(edited), "DELETE", { expectedRevision: 2, reviewed: true })).status, 200);
  await assert.rejects(prepared.assertCurrent());
  const erased = await getDb().select().from(durableMemories).where(eq(durableMemories.memoryKey, original.memoryKey));
  assert.equal(erased.length, 1);
  assert.equal(erased[0].state, "deleted");
  assert.equal(erased[0].revision, 3);
  assert.equal(erased[0].content, "[deleted]");
  assert.equal(JSON.stringify(erased).includes("Revenue"), false);
  assert.equal((await request(item(edited), "PATCH", { expectedRevision: 3, reviewed: true, content: "resurrection" })).status, 404);
  // Exercise the shared store's edit/delete and delete/delete contention directly,
  // independent of whether HTTP lookup happens before or after a completed deletion.
  for (const bothDelete of [false, true]) {
    const contested = await save("Concurrent mutation owner note");
    const outcomes = await runWithRequestIdentity(ctx, () => Promise.allSettled([
      deleteDurableMemory({ projectId: project.id, memoryKey: contested.memoryKey, expectedRevision: 1 }),
      bothDelete
        ? deleteDurableMemory({ projectId: project.id, memoryKey: contested.memoryKey, expectedRevision: 1 })
        : correctDurableMemory({ projectId: project.id, memoryKey: contested.memoryKey, expectedRevision: 1, content: "Concurrent correction" }),
    ]));
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    const refusal = outcomes.find(result => result.status === "rejected");
    assert.ok(refusal && refusal.status === "rejected");
    assert.ok(refusal.reason instanceof DurableMemoryMutationError);
    assert.equal(refusal.reason.code, "conflict");
  }

  const archived = await createProject(ctx, { name: "Archived notes" });
  const trashed = await createProject(ctx, { name: "Trashed notes" });
  const archivedNote = await save("Archived owner note", archived.id);
  const trashedNote = await save("Trashed owner note", trashed.id);
  await archiveProject(ctx, archived.id);
  await trashProject(ctx, trashed.id);
  for (const id of [archived.id, trashed.id]) {
    assert.equal((await request(collection(id))).status, 404);
    assert.equal((await request(collection(id), "POST", { content: "refused", reviewed: true })).status, 404);
  }
  for (const [saved, id] of [[archivedNote, archived.id], [trashedNote, trashed.id]] as const) {
    assert.equal((await request(item(saved, id), "PATCH", { content: "refused", expectedRevision: 1, reviewed: true })).status, 404);
    assert.equal((await request(item(saved, id), "DELETE", { expectedRevision: 1, reviewed: true })).status, 404);
  }
  for (const change of [{ active: false }, { mustChangePassword: true }, { lockedUntil: new Date(Date.now() + 60_000) },
    { role: "internal_analyst" as const }, { organizationId: org.id }]) {
    await getDb().update(users).set(change).where(eq(users.id, owner.id));
    for (const [url, method, body] of [[collection(), "GET", undefined], [collection(), "POST", { content: "refused", reviewed: true }],
      [item(other, otherProject.id), "PATCH", { content: "refused", expectedRevision: 1, reviewed: true }],
      [item(other, otherProject.id), "DELETE", { expectedRevision: 1, reviewed: true }]] as const) {
      assert.equal((await request(url, method, body)).status, 404);
    }
    await getDb().update(users).set({ active: true, mustChangePassword: false, lockedUntil: null, role: owner.role, organizationId: null }).where(eq(users.id, owner.id));
  }
  await getDb().update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id));
  assert.equal((await request(collection(clientProject.id), "POST", { content: "refused", reviewed: true }, client.id)).status, 404);
  await getDb().update(organizations).set({ status: "active" }).where(eq(organizations.id, org.id));

  const credentials = { synthetic: "not-a-real-secret" };
  await runWithRequestIdentity({ userId: foreign.id, organizationId: secondOrg.id, credentials, selectedConnectorIds: ["synthetic"] }, async () => {
    const identityNote = await createProjectMemoryNote(ctx, project.id, "Canonical identity while retaining provider context");
    const [row] = await getDb().select().from(durableMemories).where(eq(durableMemories.memoryKey, identityNote.memoryKey));
    assert.equal(row.ownerUserId, owner.id);
    assert.equal(row.organizationId, null);
    assert.equal(getRequestIdentity()?.credentials, credentials);
    assert.deepEqual(getRequestIdentity()?.selectedConnectorIds, ["synthetic"]);
  });
  await setProjectMemoryRecallConsent(ctx, project.id, false);
  await closeDb();
  await initDb();
  const reopened = await (await request(collection())).json() as ProjectMemoryNoteList;
  assert.ok(reopened.notes.length > 0);
  assert.equal(reopened.notes.some(row => row.memoryKey === original.memoryKey), false);
  assert.equal((await projectMemoryRecallConsent(ctx, project.id)).enabled, false);
  assert.equal(await prepareProjectMemoryRecall(ctx, project.id, "Pagination"), null);
  const [tombstone] = await getDb().select().from(durableMemories).where(eq(durableMemories.memoryKey, original.memoryKey));
  assert.equal(tombstone.state, "deleted");
  assert.equal(tombstone.content, "[deleted]");
  // Storage errors must never echo SQL, the body or raw driver detail through this route family.
  await closeDb();
  const unavailable = await request(collection(), "POST", { content: "private-body-text", reviewed: true });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes("private-body-text"), false);
});
