import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-lifecycle-trash-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const {
  archiveProjectChat,
  createProjectChat,
  listProjectChats,
  permanentlyDeleteProjectChat,
  restoreTrashedProjectChat,
  trashProjectChat,
} = await import("./projectChatStore");
const {
  createProject,
  getProject,
  listProjects,
  permanentlyDeleteProject,
  restoreTrashedProject,
  trashProject,
} = await import("./projectStore");
const { users } = await import("@shared/schema");

test("project Trash moves the project out of active/archive lists and restores it", async () => {
  await initDb();
  const [user] = await getDb().insert(users).values({
    email: "trash-test@example.com",
    passwordHash: "test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Trash Test",
  }).returning();
  const ctx = { userId: user.id, organizationId: null, role: user.role } as const;
  const project = await createProject(ctx, { name: "Trashable Project" });
  const chat = await createProjectChat(ctx, { projectId: project.id, scope: "project", title: "Dependent chat" });
  const archivedChat = await createProjectChat(ctx, { projectId: project.id, scope: "project", title: "Archived child" });
  await archiveProjectChat(ctx, archivedChat.id);

  const trashed = await trashProject(ctx, project.id);
  assert.equal(trashed.status, "archived");
  assert.ok(trashed.trashedAt instanceof Date);
  assert.equal((await listProjectChats(ctx, { projectId: project.id, trash: true })).some((row) => row.id === chat.id), true);
  assert.equal((await listProjects(ctx, { trash: true })).some((row) => row.id === project.id), true);

  const restored = await restoreTrashedProject(ctx, project.id);
  assert.equal(restored.status, "active");
  assert.equal((await listProjectChats(ctx, { projectId: project.id, status: "archived" })).some((row) => row.id === archivedChat.id), true);
  assert.equal((await listProjectChats(ctx, { projectId: project.id })).some((row) => row.id === chat.id), true);
  assert.equal((await listProjects(ctx, { status: "active" })).some((row) => row.id === project.id), true);

  await trashProject(ctx, project.id);
  await permanentlyDeleteProject(ctx, project.id);
  await assert.rejects(() => getProject(ctx, project.id), /not found or not owned/);
  const individualProject = await createProject(ctx, { name: "Individual Trash Project" });
  const individualChat = await createProjectChat(ctx, { projectId: individualProject.id, scope: "project", title: "Individual chat" });
  await trashProjectChat(ctx, individualChat.id);
  assert.equal((await listProjectChats(ctx, { projectId: individualProject.id, trash: true })).some((row) => row.id === individualChat.id), true);
  await restoreTrashedProjectChat(ctx, individualChat.id);
  assert.equal((await listProjectChats(ctx, { projectId: individualProject.id })).some((row) => row.id === individualChat.id), true);
  await trashProjectChat(ctx, individualChat.id);
  await permanentlyDeleteProjectChat(ctx, individualChat.id);
  assert.equal((await listProjectChats(ctx, { projectId: individualProject.id, trash: true })).some((row) => row.id === individualChat.id), false);

  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
