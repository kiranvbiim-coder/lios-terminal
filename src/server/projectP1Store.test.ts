import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p1-project-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const {
  createProject,
  findProjectByLegacyWorkspaceId,
} = await import("./projectStore");
const {
  addProjectChatMessage,
  createProjectChat,
  getProjectChat,
  listProjectChatMessages,
  listProjectChats,
  promoteQuickChatToProject,
  ProjectChatAccessDeniedError,
} = await import("./projectChatStore");
const {
  createProjectResource,
  getProjectResource,
  listProjectResources,
  setProjectResourceContextMode,
  updateProjectResourceMetadata,
  ProjectResourceAccessDeniedError,
} = await import("./projectResourceStore");
const {
  compareProjectSessions,
  createProjectSession,
  forkProjectSession,
  getParentProjectSession,
  getProjectSession,
  ProjectSessionAccessDeniedError,
} = await import("./projectSessionStore");
const { organizations, users } = await import("@shared/schema");

async function seedUser(opts: { organizationId?: number | null } = {}) {
  const [row] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.com`,
    passwordHash: "test-hash",
    role: opts.organizationId ? "client_user" : "internal_analyst",
    organizationId: opts.organizationId ?? null,
    name: "P1 Test User",
  }).returning();
  return row;
}

function validSessionState(symbol = "AAPL") {
  const tabId = `tab-${symbol.toLowerCase()}`;
  return {
    version: 1 as const,
    workspaceEngine: "dockview" as const,
    analyticalState: {
      version: 2,
      capturedAt: "2026-09-21T10:00:00.000Z",
      activeTab: {
        id: tabId,
        title: `${symbol} Analysis`,
        kind: "entity",
        entity: symbol,
        groupId: null,
        linkGroupId: "A",
        linkScopes: ["instrument"],
        pinned: false,
        workspace: {
          primary: { view: "valuation", symbol },
          secondary: { view: "chart", symbol },
          tertiary: null,
          quaternary: null,
          focusedPane: "primary",
        },
      },
      tabs: [{
        id: tabId,
        title: `${symbol} Analysis`,
        kind: "entity",
        entity: symbol,
        groupId: null,
        linkGroupId: "A",
        linkScopes: ["instrument"],
        pinned: false,
        workspace: {
          primary: { view: "valuation", symbol },
          secondary: { view: "chart", symbol },
          tertiary: null,
          quaternary: null,
          focusedPane: "primary",
        },
      }],
      activeTabIndex: 0,
      paneStates: [],
      viewStates: [],
      timeContext: { enabled: false, asOfDate: null, mode: "latest" },
    },
    dockviewLayout: { activePanel: "primary" },
    linkedContext: {
      contexts: { [tabId]: { instrument: symbol } },
      channels: {},
    },
    focusedObject: {
      kind: "panel" as const,
      id: "primary",
      label: "Valuation",
      view: "valuation",
      symbol,
      paneId: "primary" as const,
    },
    savedViewName: null,
  };
}

test("P1 Project chat/resource/session stores enforce ownership and forkable state", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [org] = await getDb().insert(organizations).values({
    name: "P1 Client Org",
    slug: `p1-${crypto.randomUUID()}`,
  }).returning();
  const owner = await seedUser();
  const other = await seedUser();
  const client = await seedUser({ organizationId: org.id });

  const ownerCtx = { userId: owner.id, organizationId: null, role: owner.role };
  const otherCtx = { userId: other.id, organizationId: null, role: other.role };
  const clientCtx = { userId: client.id, organizationId: org.id, role: client.role };

  const project = await createProject(ownerCtx, {
    name: "NVDA Research",
    legacyWorkspaceId: "legacy-workspace-1",
  });
  const otherProject = await createProject(otherCtx, { name: "Other User Project" });
  const clientProject = await createProject(clientCtx, { name: "Client Org Project" });

  await t.test("legacy workspace identity is scoped and idempotency lookup is owner-bound", async () => {
    assert.equal((await findProjectByLegacyWorkspaceId(ownerCtx, "legacy-workspace-1"))?.id, project.id);
    assert.equal(await findProjectByLegacyWorkspaceId(otherCtx, "legacy-workspace-1"), null);
    assert.equal(await findProjectByLegacyWorkspaceId(clientCtx, "legacy-workspace-1"), null);
  });

  await t.test("Project chats persist messages but another user cannot read them", async () => {
    const chat = await createProjectChat(ownerCtx, {
      projectId: project.id,
      scope: "project",
      title: "Valuation thesis",
    });
    await addProjectChatMessage(ownerCtx, chat.id, { role: "user", content: "Model the base case." });
    await addProjectChatMessage(ownerCtx, chat.id, { role: "assistant", content: "Using deterministic valuation tools." });

    const messages = await listProjectChatMessages(ownerCtx, chat.id);
    assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
    assert.equal((await listProjectChats(ownerCtx, { projectId: project.id })).length, 1);
    await assert.rejects(() => getProjectChat(otherCtx, chat.id), ProjectChatAccessDeniedError);
    await assert.rejects(() => listProjectChatMessages(otherCtx, chat.id), ProjectChatAccessDeniedError);
  });

  await t.test("Quick Chat is Project-free until explicitly promoted into an owned Project", async () => {
    const quick = await createProjectChat(ownerCtx, {
      scope: "quick",
      projectId: null,
      title: "Quick market question",
    });
    assert.equal(quick.projectId, null);
    assert.equal(quick.scope, "quick");

    await assert.rejects(
      () => promoteQuickChatToProject(ownerCtx, quick.id, otherProject.id),
      /not owned/i,
    );

    const promoted = await promoteQuickChatToProject(ownerCtx, quick.id, project.id);
    assert.equal(promoted.scope, "project");
    assert.equal(promoted.projectId, project.id);
  });

  await t.test("resource context modes stay Project-scoped and cannot cross tenants", async () => {
    const resource = await createProjectResource(ownerCtx, {
      projectId: project.id,
      kind: "file",
      label: "Management estimates",
      resourceRef: "local-file:estimates.xlsx",
      contextMode: "on_demand",
    });
    assert.equal((await getProjectResource(ownerCtx, resource.id)).contextMode, "on_demand");
    const auto = await setProjectResourceContextMode(ownerCtx, resource.id, "project");
    assert.equal(auto.contextMode, "project");
    assert.equal((await listProjectResources(ownerCtx, project.id)).length, 1);
    await assert.rejects(() => getProjectResource(otherCtx, resource.id), ProjectResourceAccessDeniedError);
    await assert.rejects(() => listProjectResources(clientCtx, project.id), /not owned/i);
    assert.equal((await listProjectResources(clientCtx, clientProject.id)).length, 0);
  });

  await t.test("Personal Finance resource metadata remains tenant-scoped and excluded from normal Project context", async () => {
    const profileResource = await createProjectResource(ownerCtx, {
      projectId: project.id,
      kind: "personal_finance_profile",
      label: "Personal Finance & Wealth",
      resourceRef: "lios:personal-finance-profile",
      contextMode: "excluded",
      metadata: { profile: { schemaVersion: "1", asOf: "2026-09-24", accounts: [], transactions: [], debts: [], goals: [], retirement: null } },
    });
    assert.equal(profileResource.contextMode, "excluded");
    const updated = await updateProjectResourceMetadata(ownerCtx, profileResource.id, {
      profile: { schemaVersion: "1", asOf: "2026-09-25", accounts: [], transactions: [], debts: [], goals: [], retirement: null },
    });
    assert.equal((updated.metadata.profile as { asOf: string }).asOf, "2026-09-25");
    assert.equal(updated.contextMode, "excluded");
    await assert.rejects(
      () => updateProjectResourceMetadata(otherCtx, profileResource.id, { profile: {} }),
      ProjectResourceAccessDeniedError,
    );
  });

  await t.test("Sessions bind chat/parent to the same Project and preserve fork lineage", async () => {
    const chat = await createProjectChat(ownerCtx, {
      projectId: project.id,
      scope: "project",
      title: "IC session",
    });
    const base = await createProjectSession(ownerCtx, {
      projectId: project.id,
      chatId: chat.id,
      name: "Base",
      workspaceState: validSessionState("NVDA"),
    });
    const fork = await forkProjectSession(ownerCtx, base.id, "Bull case fork");
    assert.equal(fork.parentSessionId, base.id);
    assert.equal((await getParentProjectSession(ownerCtx, fork.id))?.id, base.id);

    const comparison = await compareProjectSessions(ownerCtx, base.id, fork.id);
    assert.equal(comparison.sameProject, true);
    assert.equal(comparison.sameChat, true);
    assert.equal(comparison.analyticalStateChanged, false);

    await assert.rejects(() => getProjectSession(otherCtx, base.id), ProjectSessionAccessDeniedError);

    const secondProject = await createProject(ownerCtx, { name: "Second Owner Project" });
    const foreignChat = await createProjectChat(ownerCtx, {
      projectId: secondProject.id,
      scope: "project",
      title: "Different project",
    });
    await assert.rejects(
      () => createProjectSession(ownerCtx, {
        projectId: project.id,
        chatId: foreignChat.id,
        name: "Invalid cross-project chat",
        workspaceState: validSessionState(),
      }),
      /same Project/i,
    );

    const foreignParent = await createProjectSession(ownerCtx, {
      projectId: secondProject.id,
      name: "Foreign parent",
      workspaceState: validSessionState("MSFT"),
    });
    await assert.rejects(
      () => createProjectSession(ownerCtx, {
        projectId: project.id,
        parentSessionId: foreignParent.id,
        name: "Invalid cross-project parent",
        workspaceState: validSessionState(),
      }),
      /same Project/i,
    );
  });

  await t.test("Session comparison canonicalization remains deterministic for optional values", async () => {
    const base = await createProjectSession(ownerCtx, {
      projectId: project.id,
      name: "Canonical base",
      workspaceState: validSessionState("AAPL"),
    });
    const fork = await forkProjectSession(ownerCtx, base.id, "Canonical fork");
    const comparison = await compareProjectSessions(ownerCtx, base.id, fork.id);
    assert.equal(comparison.analyticalStateChanged, false);
    assert.equal(comparison.linkedContextChanged, false);
  });

  await t.test("Session persistence rejects credential material before insert", async () => {
    const unsafe = validSessionState() as any;
    unsafe.dockviewLayout = { params: { accessToken: "never-persist" } };
    await assert.rejects(
      () => createProjectSession(ownerCtx, {
        projectId: project.id,
        name: "Unsafe",
        workspaceState: unsafe,
      }),
      /must not contain credentials/i,
    );
  });
});
