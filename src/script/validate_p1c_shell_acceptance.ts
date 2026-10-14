import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.resolve(root, relative), "utf8");
}

function requireMatch(source: string, pattern: RegExp, message: string): void {
  if (!pattern.test(source)) throw new Error(message);
}

function requireAbsent(source: string, pattern: RegExp, message: string): void {
  if (pattern.test(source)) throw new Error(message);
}

// P1A — anonymous execution is gone and authentication is the executable boundary.
const app = read("client/src/App.tsx");
const publicPreview = read("client/src/pages/PublicProductPreview.tsx");
const publicRoutes = read("server/publicRoutes.ts");
requireMatch(app, /PublicProductPreview/, "P1C certification: signed-out entry must remain the non-executable public preview.");
requireAbsent(app, /GuestConversationHome/, "P1C certification: executable guest conversation must not return.");
requireAbsent(app, /PersonaOnboarding|environmentSetupNeeded/, "P1C certification: persona/setup cannot gate first authenticated value.");
requireMatch(app, /session && environmentSetupOpen/, "P1C certification: Connection Center must remain contextual after sign-in.");
requireMatch(publicPreview, /DEMO DATA[\s\S]*Not a live calculation or\s+source receipt/, "P1C certification: public preview must disclose its non-executable boundary: illustrative content is not a live calculation or source receipt.");
requireAbsent(publicPreview, /\/api\/public\/research\/quick|fetch\(/, "P1C certification: public preview must not execute research/data calls.");
requireAbsent(publicRoutes, /\/api\/public\/research\/quick|runGuestPublicResearch|guestResearchRequestSchema/, "P1C certification: anonymous server research execution must remain removed.");

// P1B — canonical identity/access/session/ownership remains the shell foundation.
const auth = read("server/auth.ts");
const identity = read("shared/identityContracts.ts");
const tenant = read("server/tenantContext.ts");
const migration = read("server/projectMigrationService.ts");
requireMatch(identity, /identityPrincipalSchema/, "P1C certification: canonical principal contract is missing.");
requireMatch(identity, /effectiveAccessSnapshotSchema/, "P1C certification: effective-access contract is missing.");
requireMatch(auth, /\/api\/client\/control-plane\/snapshot/, "P1C certification: effective-access snapshot route is missing.");
requireMatch(auth, /resolveSessionRestoration/, "P1C certification: startup session restoration is missing.");
requireMatch(auth, /featureIsEntitled\(snapshot, featureKey\)/, "P1C certification: product authorization must remain feature-key based.");
requireMatch(tenant, /assertOwnedByTenant/, "P1C certification: exact authenticated work-ownership guard is missing.");
requireMatch(migration, /assertLegacyWorkClaim\(ctx, workspace\.createdByUserId\)/, "P1C certification: legacy work claim must remain creator-bound.");

// P1C — one authenticated composer with explicit governed source scope.
const runtimeContract = read("shared/conversationRuntime.ts");
const runtime = read("server/conversationRuntime.ts");
const p1Shell = read("client/src/lib/p1Shell.ts");
const projectShell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const terminal = read("client/src/pages/Terminal.tsx");

// The vocabulary has a single definition in shared/sourceScope.ts; the runtime contract must consume it.
requireMatch(read("shared/sourceScope.ts"), /conversationSourceScopeSchema\s*=\s*z\.enum\(\["auto", "my_data", "web", "files"\]\)/, "P1C source-scope vocabulary must be canonical.");
requireMatch(runtimeContract, /from "\.\/sourceScope"/, "P1C runtime contract must consume the canonical source-scope vocabulary.");
requireMatch(runtimeContract, /sourceScope:\s*conversationSourceScopeSchema\.default\("auto"\)/, "P1C conversation request/context must default source scope to Auto.");
requireMatch(runtime, /if \(sourceScope === "web"\) return \[\]/, "P1C Web scope must exclude Project resources.");
requireMatch(runtime, /if \(sourceScope === "files"\) return explicitlyAttached/, "P1C Files scope must include only explicitly attached Project resources.");
requireMatch(runtime, /sourceScopeAllowsExternalData\(sourceScope\)/, "P1C connected/external retrieval must consult the selected source scope.");
requireMatch(runtime, /throw sourceScopeGap\(sourceScope, "external"\)/, "P1C external retrieval must fail closed rather than bypass source scope.");
requireMatch(runtime, /sourceScopeAllowsProjectData\(sourceScope\)/, "P1C Project Intelligence must consult the selected source scope.");
requireMatch(runtime, /User-selected source scope/, "P1C AI prompt must carry the source-scope boundary.");
requireMatch(runtime, /do not present model background knowledge as observed Project evidence/i, "P1C My Data scope must not relabel model knowledge as Project evidence.");
requireMatch(runtime, /if the files do not support a factual claim, say the evidence is missing/i, "P1C Files scope must fail visibly on unsupported evidence.");

requireAbsent(projectShell, /data-p1c-context-strip="true"/, "P1C source scope must not consume a permanent conversation bar.");
requireMatch(projectShell, /DropdownMenuSubTrigger>Sources/, "P1C source scope must remain available through progressive disclosure.");
requireMatch(projectShell, /P1_SOURCE_SCOPES\.map/, "P1C composer must render the canonical source scopes on demand.");
requireMatch(projectShell, /sourceScope,\s*\n\s*executionMode/, "P1C source scope must be sent with the Conversation Request.");
requireMatch(projectShell, /WorkSearchDialog/, "P1C authenticated shell must mount saved-work Search.");
requireMatch(projectShell, /lios:open-work-search/, "P1C Project shell must receive the global saved-work Search shortcut.");
requireMatch(terminal, /event\.key\.toLowerCase\(\) === "k"[\s\S]{0,220}lios:open-work-search/, "P1C Cmd\/Ctrl+K must converge on saved-work Search in the Project\/chat surface.");
requireMatch(projectShell, /e\.key === "Escape" && busy/, "P1C Escape-to-cancel keyboard recovery is missing.");
requireMatch(projectShell, /aria-label="Ask LiOS"/, "P1C universal composer needs an accessible name.");
requireMatch(projectShell, /role="status" aria-live="polite"/, "P1C shell loading state must be announced.");
requireMatch(projectShell, /Workspace recovery/, "P1C shell error\/recovery state is missing.");
requireMatch(projectShell, /Retry restore/, "P1C shell retry action is missing.");
requireMatch(projectShell, /Open Temporary Chat/, "P1C recovery must preserve a bounded memory-only conversation escape hatch.");
requireMatch(projectShell, /Files scope requires at least one explicitly attached Project file/, "P1C Files scope must not masquerade as having evidence without a file.");
requireMatch(projectShell, /Web scope excludes Project file contents/, "P1C Web scope must make staged-file exclusion explicit.");
requireMatch(projectShell, /mentionCandidates/, "P1C @ Project-reference convergence is missing.");
requireMatch(projectShell, /QUICK_COMMANDS/, "P1C slash-command convergence is missing.");

// Clean install: authenticated user can ask immediately; no Project or connector setup is required.
requireMatch(p1Shell, /resolveComposerPersistenceTarget/, "P1C clean-install persistence contract is missing.");
requireMatch(p1Shell, /input\.chatMode === "project" && input\.projectId/, "P1C clean-install contract must choose Project persistence only when a Project exists.");
requireMatch(p1Shell, /return "quick";/, "P1C clean-install contract must fall back to Quick Chat.");
requireMatch(projectShell, /resolveComposerPersistenceTarget\(/, "P1C first-message flow must use the clean-install persistence contract.");
requireMatch(projectShell, /await createQuickChat\(\)/, "P1C authenticated first message must have a Quick Chat path without Project setup.");
requireAbsent(projectShell, /environmentSetupNeeded|PersonaOnboarding/, "P1C composer must not depend on onboarding/setup state.");

// Living Workspace: LiOS remains the sole state owner; AI can request bounded actions.
requireMatch(projectShell, /requestSafeWorkspaceAction/, "P1C conversation shell must route workspace requests through LiOS safe actions.");
requireMatch(terminal, /subscribeSafeWorkspaceActions/, "P1C Terminal must remain the executor of safe workspace actions.");
requireMatch(terminal, /pendingWorkspaceProposal/, "P1C layout-changing workspace proposals must keep an explicit approval surface.");
requireMatch(terminal, /DockviewWorkspaceGrid/, "P1C professional depth must reuse the existing LiOS Workbench.");
requireAbsent(projectShell, /new Dockview|createDockview|assistant-cloud/i, "P1C conversation shell must not create a second workspace\/cloud state owner.");

// Telemetry/privacy/accessibility certification.
requireMatch(p1Shell, /storesPromptText:\s*false/, "P1C telemetry must not retain prompt text.");
requireMatch(p1Shell, /storesFileNames:\s*false/, "P1C telemetry must not retain file names.");
requireMatch(p1Shell, /storesFileContents:\s*false/, "P1C telemetry must not retain file contents.");
requireMatch(p1Shell, /storesProjectNames:\s*false/, "P1C telemetry must not retain Project names.");
requireMatch(p1Shell, /storesClientNames:\s*false/, "P1C telemetry must not retain client names.");
requireMatch(p1Shell, /storesSymbols:\s*false/, "P1C telemetry must not retain symbols.");
requireMatch(p1Shell, /storesProviderCredentials:\s*false/, "P1C telemetry must not retain provider credentials.");
requireMatch(projectShell, /DropdownMenuRadioGroup value=\{sourceScope\}/, "P1C source-scope controls must expose one selected value.");
requireMatch(projectShell, /DropdownMenuRadioItem key=\{scope\.id\} value=\{scope\.id\}/, "P1C source-scope controls must remain keyboard-accessible radio items.");
requireMatch(projectShell, /Not saved/, "P1C Temporary Chat must visibly disclose that it is not persisted.");

console.log(JSON.stringify({
  contractVersion: "p1c-1.0.0",
  p1Complete: true,
  entryBoundary: "authenticated-execution-only",
  startup: {
    setupGate: false,
    zeroProjectFirstQuestion: "quick-chat",
    sessionRestoration: "canonical-p1b",
  },
  composer: {
    universal: true,
    sourceScopes: ["auto", "my_data", "web", "files"],
    projectReferences: "@",
    commands: "/",
    savedWorkSearchShortcut: "Cmd/Ctrl+K",
    cancelShortcut: "Escape",
  },
  livingWorkspace: {
    canonicalStateOwner: "LiOS",
    safeActionBoundary: true,
    layoutChangeRequiresApproval: true,
  },
  recovery: {
    loadingState: true,
    errorState: true,
    retry: true,
    temporaryChatFallback: true,
  },
  privacy: {
    shellTelemetryLocalOnly: true,
    rawPromptOrFileTelemetry: false,
  },
  migration: {
    legacyClaimByCreatorOnly: true,
  },
}, null, 2));
