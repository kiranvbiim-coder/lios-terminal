import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.resolve(root, relative), "utf8");
}

function json<T = any>(relative: string): T {
  return JSON.parse(read(relative)) as T;
}

function requireMatch(source: string, pattern: RegExp, message: string): void {
  if (!pattern.test(source)) throw new Error(message);
}

function requireAbsent(source: string, pattern: RegExp, message: string): void {
  if (pattern.test(source)) throw new Error(message);
}

const pkg = json<any>("package.json");
if (pkg.dependencies?.["dockview-react"] !== "8.3.1") {
  throw new Error("P1 requires dockview-react pinned exactly to 8.3.1.");
}
if (pkg.overrides?.dockview !== "8.3.1" || pkg.overrides?.["dockview-core"] !== "8.3.1") {
  throw new Error("P1 must pin dockview and dockview-core transitively to 8.3.1.");
}
if (pkg.dependencies?.["flexlayout-react"] || pkg.dependencies?.["dockview-enterprise"]) {
  throw new Error("P1 must ship one OSS docking system only; FlexLayout and Dockview Enterprise are excluded.");
}

const appEntry = read("client/src/App.tsx");
const publicPreview = read("client/src/pages/PublicProductPreview.tsx");
requireMatch(appEntry, /PublicProductPreview/, "P1 signed-out entry must render the public LiOS product preview.");
requireAbsent(appEntry, /GuestConversationHome/, "P1 must not restore the executable guest conversation shell.");
requireAbsent(appEntry, /ExperienceCenter|#\/experience/, "P1 legacy Experience Center hash must not bypass the single public preview/auth boundary.");
requireMatch(publicPreview, /DEMO DATA[\s\S]*Not a live calculation or\s+source receipt/, "P1 public preview must disclose the locked product boundary: illustrative content is not a live calculation or source receipt.");
requireMatch(publicPreview, /const requireSignIn = \(\) =>/, "P1 public product actions must converge on sign-in.");
requireMatch(publicPreview, /const requireRegistration = \(\) =>/, "P1 public create-account actions must converge on registration.");
requireMatch(publicPreview, /initialMode=\{loginMode\}/, "P1 public preview must pass the selected auth mode into the login surface.");
requireAbsent(publicPreview, /\/api\/public\/research\/quick/, "P1 public preview must not execute anonymous research.");
requireAbsent(publicPreview, /fetch\(/, "P1 public preview must not execute network data/research calls.");
requireAbsent(read("server/routes.ts"), /\/api\/public\/leads|\/api\/public\/research\/quick|runGuestPublicResearch|guestResearchRequestSchema/, "P1 anonymous server surface must not expose lead capture or research execution.");

const lock = json<any>("package-lock.json");
for (const [entry, version] of [
  ["node_modules/dockview-react", "8.3.1"],
  ["node_modules/dockview", "8.3.1"],
  ["node_modules/dockview-core", "8.3.1"],
] as const) {
  const actual = lock.packages?.[entry]?.version;
  if (actual !== version) throw new Error(`P1 package-lock must pin ${entry} to ${version}; found ${actual ?? "missing"}.`);
}

const registry = json<any>("../third_party/components.json");
const dockview = registry.components?.find((item: any) => item.id === "dockview");
if (!dockview || dockview.bundled !== true || dockview.posture !== "bundled" || dockview.classification !== "production") {
  throw new Error("P1 OSS registry must mark Dockview OSS core as bundled production.");
}
if ((dockview.destinationPaths ?? []).some((value: string) => /enterprise/i.test(value))) {
  throw new Error("Dockview Enterprise must not appear in the LiOS bundled destination set.");
}

const schema = [
  read("shared/schema.ts"),
  read("shared/schemaCore.ts"),
  read("shared/schemaProjects.ts"),
].join("\n");
for (const table of ["projectChats", "projectChatMessages", "projectResources", "projectSessions"]) {
  requireMatch(schema, new RegExp(`export const ${table}\\s*=\\s*pgTable`), `P1 schema missing ${table}.`);
}
requireMatch(schema, /legacyWorkspaceId:\s*text\("legacy_workspace_id"\)/, "P1 Project schema must preserve legacy migration identity.");
requireMatch(
  schema,
  /project_sessions_parent_session_id_project_sessions_id_fk/,
  "P1 Project Session schema must declare the same self-parent foreign key as migration 0066.",
);

const contracts = read("shared/projectContracts.ts");
requireMatch(contracts, /SENSITIVE_SESSION_KEY/, "P1 Session contract must reject secret-bearing workspace state.");
requireMatch(contracts, /workspaceActionNeedsConfirmation/, "P1 safe workspace action policy is missing.");
requireMatch(contracts, /type:\s*z\.literal\("close-panel"\)/, "P1 Living Workspace canonical close-panel action is missing.");
requireMatch(contracts, /dockviewLayout:/, "P1 Session contract must capture Dockview layout state.");

const chatRoutes = read("server/projectConversationRoutes.ts") + read("server/conversationRunService.ts");
requireAbsent(chatRoutes, /from "\.\/aiMemory"/, "Project chat must not use legacy global AI memory.");

const conversationRuntime = read("server/conversationRuntime.ts");
requireMatch(conversationRuntime, /contextMode === "excluded"/, "Project chat must enforce excluded-resource context.");
requireMatch(conversationRuntime, /userMentionTokens\(message\)/, "Project chat must support explicit @ on-demand resource context.");

const workspaceDirectives = read("client/src/lib/projectWorkspaceDirectives.ts");
requireMatch(workspaceDirectives, /WORKSPACE_LAYOUT/, "Project chat must constrain assistant workspace directives.");

const livingWorkspaceAdapter = read("client/src/lib/livingWorkspaceAdapter.ts");
const livingWorkspaceAdapterTests = read("client/src/lib/livingWorkspaceAdapter.test.ts");
requireMatch(livingWorkspaceAdapter, /WorkspaceAdapter/, "P1 Living Workspace must implement the shared WorkspaceAdapter seam.");
requireMatch(livingWorkspaceAdapter, /captureProjectWorkspaceSessionState/, "P1 snapshot must capture canonical LiOS workspace state.");
requireMatch(livingWorkspaceAdapter, /updateProjectSession/, "P1 snapshot must persist through the existing Project Session path.");
requireMatch(livingWorkspaceAdapter, /restoreProjectSessionRecord/, "P1 restore must load the canonical persisted Project Session.");
requireMatch(livingWorkspaceAdapter, /restoreProjectWorkspaceSessionState/, "P1 restore must delegate to canonical workspace-state restore.");
requireMatch(livingWorkspaceAdapter, /requestSafeWorkspaceAction/, "P1 panel operations must delegate to LiOS safe workspace actions.");
requireMatch(livingWorkspaceAdapter, /isViewVisibleToAudience/, "P1 must reject views unavailable to the active audience.");
requireAbsent(livingWorkspaceAdapter, /new RuntimeRegistry/, "P1 must not introduce a second runtime registry.");
requireAbsent(livingWorkspaceAdapter, /localStorage|sessionStorage/, "P1 adapter must not create a second workspace persistence store.");
requireMatch(livingWorkspaceAdapterTests, /replaceable through the existing RuntimeRegistry/, "P1 adapter replacement behavior needs focused test coverage.");
requireMatch(livingWorkspaceAdapterTests, /fail closed on missing or mismatched identity/, "P1 identity mismatch behavior needs focused test coverage.");

const projectRoutes = read("server/projectRoutes.ts");
requireMatch(projectRoutes, /migrate-legacy-workspaces/, "P1 legacy Workbench migration route is missing.");
requireMatch(projectRoutes, /\/fork"/, "P1 Session fork route is missing.");
requireMatch(projectRoutes, /\/compare\//, "P1 Session compare route is missing.");

const projectShell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
requireMatch(projectShell, /Temporary chat|Open Temporary Chat/, "P1 Temporary Chat UX is missing.");
requireMatch(projectShell, /Not saved/, "Temporary Chat must visibly disclose non-persistence.");
requireMatch(projectShell, /recentChats/, "P1 Recent chat navigation is missing.");
requireMatch(projectShell, /createQuickChat/, "P1 Quick Chat persistence path is missing.");
requireMatch(projectShell, /Session Vault/, "P1 Session Vault UX is missing.");
requireMatch(projectShell, /parseProjectWorkspaceDirectives/, "Project chat must sanitize machine workspace directives from visible prose.");
requireMatch(projectShell, /workspaceAdapter\.openPanel/, "P1 Project chat must consume the active WorkspaceAdapter for panel opens.");
requireMatch(projectShell, /workspaceAdapter\.snapshot/, "P1 Session save must exercise the WorkspaceAdapter snapshot bridge.");
requireMatch(projectShell, /workspaceAdapter\.restore/, "P1 Session restore must exercise the WorkspaceAdapter restore bridge.");

const waveC = read("shared/waveCContracts.ts");
requireMatch(waveC, /id:\s*"projects"/, "Projects must be a first-class experience surface.");

const dockGrid = read("client/src/components/terminal/DockviewWorkspaceGrid.tsx");
requireMatch(dockGrid, /DockviewReact/, "P1 Workbench must use the selected Dockview OSS renderer.");
requireMatch(dockGrid, /DockviewDefaultTab[\s\S]{0,120}hideClose|<DockviewDefaultTab[^>]*hideClose/, "Dockview native close semantics must remain disabled.");
requireAbsent(dockGrid, /onDidRemovePanel/, "Dockview remove events must not mutate canonical LiOS pane state because relocation fires remove/add.");
requireMatch(dockGrid, /latestPropsRef/, "Dockview event callbacks must not capture stale LiOS workspace state.");

const snapshot = read("client/src/lib/analyticalWorkspaceSnapshot.ts");
requireMatch(snapshot, /id:\s*tab\.id/, "P1 Session capture must preserve stable tab identity.");
requireMatch(snapshot, /snapshot\.id\s*\?\?\s*restoredTabId/, "P1 Session restore must reuse stable tab identity.");

const terminal = read("client/src/pages/Terminal.tsx");
requireMatch(terminal, /subscribeSafeWorkspaceActions/, "Terminal must execute workspace actions only through the LiOS safe-action subscriber.");
requireMatch(terminal, /createLivingWorkspaceAdapter/, "P1 Terminal must instantiate the Living Workspace adapter.");
requireMatch(terminal, /workspaceAdapter=\{livingWorkspaceAdapter\}/, "P1 Terminal must pass the active adapter into Project runtime.");
requireMatch(terminal, /action\.type === "close-panel"/, "P1 close-panel safe actions must mutate canonical Terminal state.");
requireMatch(terminal, /closeWorkspacePane\(current, action\.paneId\)/, "P1 close-panel handling must use the canonical LiOS workspace reducer.");
requireMatch(terminal, /pendingWorkspaceProposal/, "Layout proposals must require an explicit approval surface.");
requireMatch(terminal, /DockviewWorkspaceGrid/, "P1 Terminal must wire the Dockview Workbench.");

console.log(JSON.stringify({
  contractVersion: "1.0.0",
  projectChatPersistence: true,
  temporaryChatMemoryOnly: true,
  quickChatPromotion: true,
  projectResourceScopes: true,
  sessionVault: {
    save: true,
    restore: true,
    fork: true,
    compare: true,
    secretGuard: true,
    stableTabIds: true,
    dockviewLayout: true,
  },
  livingWorkspace: {
    renderer: "dockview-react@8.3.1",
    adapter: "lios.workspace.living",
    adapterWiredToTerminal: true,
    canonicalStateOwner: "LiOS",
    projectSessionSnapshotRestore: true,
    identityMismatchFailsClosed: true,
    nativeDonorCloseDisabled: true,
    safeOpenFocusClose: true,
    layoutProposalConfirmation: true,
  },
  excluded: ["flexlayout-react", "dockview-enterprise", "assistant-cloud"],
}, null, 2));
