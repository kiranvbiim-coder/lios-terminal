import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// db.ts reads process.env.LIMURIA_DATA_DIR at module-evaluation time (not
// inside a function), so ./db must not be imported until that env var is
// set on the line below -- a static top-level import would run before this
// file's own code executes and would bind to the wrong data directory.
// This is a genuine module-loading-boundary exception (node:test has no
// per-file "beforeEach module load" hook), same pattern as
// companyStore.test.ts / controlPlaneService.test.ts / dataSpineIngestionMonitor.test.ts.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-project-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const {
  createProject,
  getProject,
  listProjects,
  renameProject,
  setProjectInstructions,
  setProjectPinned,
  touchProjectActivity,
  archiveProject,
  restoreProject,
  ProjectAccessDeniedError,
} = await import("./projectStore");
const { users, organizations } = await import("@shared/schema");

async function seedUser(t: { after: (fn: () => unknown) => void }, opts: { organizationId?: number | null } = {}) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({
      email: `${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: "test-hash",
      role: opts.organizationId ? "client_user" : "internal_analyst",
      organizationId: opts.organizationId ?? null,
      name: "Test User",
    })
    .returning();
  return row;
}

test("projectStore: CRUD, ownership isolation and status transitions", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const db = getDb();
  const [org] = await db.insert(organizations).values({ name: "Acme RIA", slug: "acme-ria" }).returning();

  const internalUser = await seedUser(t);
  const otherInternalUser = await seedUser(t);
  const clientUser = await seedUser(t, { organizationId: org.id });

  const internalCtx = { userId: internalUser.id, organizationId: null, role: internalUser.role };
  const otherInternalCtx = { userId: otherInternalUser.id, organizationId: null, role: otherInternalUser.role };
  const clientCtx = { userId: clientUser.id, organizationId: org.id, role: clientUser.role };

  await t.test("create + get round-trips and defaults to active/unpinned", async () => {
    const project = await createProject(internalCtx, { name: "  NVIDIA Investment Thesis  " });
    assert.equal(project.name, "NVIDIA Investment Thesis", "insertProjectSchema trims on create too, consistent with renameProject's explicit trim");
    assert.equal(project.status, "active");
    assert.equal(project.pinned, false);
    assert.equal(project.organizationId, null);
    assert.equal(project.instructions, null);

    const fetched = await getProject(internalCtx, project.id);
    assert.deepEqual(fetched, project);
  });

  await t.test("organization scoping: client user's project carries organizationId", async () => {
    const project = await createProject(clientCtx, { name: "India Macro" });
    assert.equal(project.organizationId, org.id);
    const fetched = await getProject(clientCtx, project.id);
    assert.equal(fetched.id, project.id);
  });

  await t.test("isolation: another internal user cannot read or act on a project they do not own", async () => {
    const project = await createProject(internalCtx, { name: "My Portfolio" });
    await assert.rejects(() => getProject(otherInternalCtx, project.id), ProjectAccessDeniedError);
    await assert.rejects(() => renameProject(otherInternalCtx, project.id, "Hijacked"), ProjectAccessDeniedError);
    await assert.rejects(() => archiveProject(otherInternalCtx, project.id), ProjectAccessDeniedError);
    // Original untouched by the rejected attempts.
    const stillOwned = await getProject(internalCtx, project.id);
    assert.equal(stillOwned.name, "My Portfolio");
    assert.equal(stillOwned.status, "active");
  });

  await t.test("isolation: internal (no-org) and client (org-scoped) contexts never cross despite shared ownerUserId patterns", async () => {
    // Different users entirely, but this guards the IS NULL vs = comparison
    // path specifically: an org-scoped context must not match a null-org row.
    const internalProject = await createProject(internalCtx, { name: "Internal Only" });
    await assert.rejects(() => getProject(clientCtx, internalProject.id), ProjectAccessDeniedError);
  });

  await t.test("rename: trims, rejects empty, rejects over-length", async () => {
    const project = await createProject(internalCtx, { name: "Draft" });
    const renamed = await renameProject(internalCtx, project.id, "  M&A Target Screen  ");
    assert.equal(renamed.name, "M&A Target Screen");
    await assert.rejects(() => renameProject(internalCtx, project.id, "   "), /cannot be empty/);
    await assert.rejects(() => renameProject(internalCtx, project.id, "x".repeat(201)), /cannot exceed 200/);
  });

  await t.test("instructions: set, clear, over-length rejected", async () => {
    const project = await createProject(internalCtx, { name: "Instructed" });
    const withInstructions = await setProjectInstructions(internalCtx, project.id, "  Only use filings and my imported estimates.  ");
    assert.equal(withInstructions.instructions, "Only use filings and my imported estimates.");
    const cleared = await setProjectInstructions(internalCtx, project.id, "   ");
    assert.equal(cleared.instructions, null);
    await assert.rejects(() => setProjectInstructions(internalCtx, project.id, "x".repeat(4001)), /cannot exceed 4000/);
  });

  await t.test("pin: toggles and affects listProjects ordering ahead of recency", async () => {
    const older = await createProject(internalCtx, { name: "Older Unpinned" });
    const newer = await createProject(internalCtx, { name: "Newer Unpinned" });
    await touchProjectActivity(internalCtx, newer.id);
    await setProjectPinned(internalCtx, older.id, true);

    const list = await listProjects(internalCtx);
    const ids = list.map((p) => p.id);
    assert.ok(ids.indexOf(older.id) < ids.indexOf(newer.id), "pinned project sorts ahead of a more recently active unpinned one");
  });

  await t.test("archive/restore: leaves the active list, reappears on restore, getProject still resolves while archived", async () => {
    const project = await createProject(internalCtx, { name: "To Archive" });
    const activeBefore = await listProjects(internalCtx, { status: "active" });
    assert.ok(activeBefore.some((p) => p.id === project.id));

    const archived = await archiveProject(internalCtx, project.id);
    assert.equal(archived.status, "archived");
    assert.ok(archived.archivedAt instanceof Date);

    const activeAfter = await listProjects(internalCtx, { status: "active" });
    assert.ok(!activeAfter.some((p) => p.id === project.id), "archived project no longer appears in the active list");

    const archivedList = await listProjects(internalCtx, { status: "archived" });
    assert.ok(archivedList.some((p) => p.id === project.id));

    // Archived rows must still resolve directly (e.g. to open from an
    // "archived projects" view) even though they're excluded from the
    // default active listing.
    const stillFetchable = await getProject(internalCtx, project.id);
    assert.equal(stillFetchable.status, "archived");

    const restored = await restoreProject(internalCtx, project.id);
    assert.equal(restored.status, "active");
    assert.equal(restored.archivedAt, null);
    const activeOnceMore = await listProjects(internalCtx, { status: "active" });
    assert.ok(activeOnceMore.some((p) => p.id === project.id));
  });

  await t.test("touchProjectActivity bumps lastActivityAt without changing updatedAt", async () => {
    const project = await createProject(internalCtx, { name: "Activity Test" });
    const before = project.updatedAt.getTime();
    await touchProjectActivity(internalCtx, project.id);
    const after = await getProject(internalCtx, project.id);
    // No artificial delay: touchProjectActivity's own getProject()
    // ownership check plus the UPDATE round-trip already put real
    // (non-guessed) async work between the two new Date() calls, which is
    // enough for the DB's microsecond-precision timestamp to differ from
    // the millisecond captured at creation.
    assert.ok(after.lastActivityAt.getTime() >= project.lastActivityAt.getTime());
    assert.notEqual(after.lastActivityAt.getTime(), project.lastActivityAt.getTime(), "activity touch must actually advance lastActivityAt");
    assert.equal(after.updatedAt.getTime(), before, "activity touch must not count as an edit");
  });
});
