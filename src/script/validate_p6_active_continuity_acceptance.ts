import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const must = (value: boolean, message: string) => {
  if (!value) throw new Error("P6 active continuity acceptance failed: " + message);
};

const contracts = read("shared/p6ContinuityContracts.ts");
const service = read("server/p6ProjectContinuity.ts");
const routes = read("server/p6ContinuityRoutes.ts");
const routeRegistry = read("server/routes.ts");
const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const projectHome = read("client/src/components/terminal/ProjectHome.tsx");
const panel = read("client/src/components/terminal/ProjectContinuityPanel.tsx");
const intelligenceHook = read("client/src/lib/useProjectIntelligence.ts");
const artifactHook = read("client/src/lib/useArtifacts.ts");
const automationHook = read("client/src/lib/useP9Automation.ts");
const conversationRuntime = read("server/conversationRuntime.ts");
const conversationResolver = read("server/conversationCapabilityResolver.ts");
const conversationContracts = read("shared/conversationRuntime.ts");
const packageJson = JSON.parse(read("package.json"));
const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");

must(contracts.includes("p6ProjectContinuitySnapshotSchema"), "canonical P6 continuity contract is missing.");
must(contracts.includes("p6DecisionMemoryEntrySchema"), "Decision Memory contract is missing.");
must(service.includes("currentProjectIntelligence"), "P6 must compose canonical Project Intelligence.");
must(service.includes("listP9Workflows"), "P6 must compose canonical continuous-intelligence workflows.");
must(service.includes("decisionArtifactContentSchema"), "P6 must use versioned Decision Artifacts as Project decision memory.");
must(!service.includes("pgTable("), "P6 convergence must not create a second persistence authority.");
must(!service.includes("setInterval("), "P6 convergence must not create a second scheduler.");
must(routes.includes("/api/projects/:projectId/continuity"), "authenticated Project Continuity route is missing.");
must(routeRegistry.includes("registerP6ContinuityRoutes"), "P6 continuity routes are not registered.");
must(shell.includes("ProjectHome") && projectHome.includes("ProjectContinuityPanel"), "Project shell does not expose the continuity layer.");
must(panel.includes("data-p6-project-continuity"), "Project Continuity UI contract marker is missing.");
must(panel.includes("Open decision") && panel.includes("Review workflow"), "Project Continuity follow-up controls are not actionable.");
must(service.includes('namespacedNodeId("session"'), "Session node identities are not normalized.");
must(service.includes("existingGraphNodeId"), "Continuity graph does not reuse canonical existing graph nodes.");
must(intelligenceHook.includes('["/api/projects", projectId, "continuity"]'), "Project Intelligence changes do not invalidate Continuity.");
must(artifactHook.includes('["/api/projects", projectId, "continuity"]'), "Artifact changes do not invalidate Continuity.");
must(automationHook.includes('["/api/projects", projectId, "continuity"]'), "Automation changes do not invalidate Continuity.");
must(conversationRuntime.includes('"lios.project.continuity"'), "Project Continuity is not registered in the governed conversation tool runtime.");
must(conversationRuntime.includes('"p6_project_continuity"'), "Conversation execution does not route the active P6 continuity workflow.");
must(conversationResolver.includes('"project.continuity"'), "Conversation capability resolver does not expose Project Continuity.");
must(conversationContracts.includes('"project.continuity"'), "Project Continuity is missing from the canonical conversation capability contract.");
must(String(packageJson.scripts["test:p6"] || "").includes("server/p6ProjectContinuity.test.ts"), "active P6 tests are not wired into test:p6.");
must(String(packageJson.scripts["acceptance:p6"] || "").includes("validate_p6_active_continuity_acceptance.ts"), "active P6 acceptance is not wired.");
must(roadmap.includes("P6 — Project Graph, Decision Memory & Continuous Intelligence"), "active seven-phase P6 definition is missing.");

console.log("P6 active Project Graph / Decision Memory / Continuous Intelligence acceptance: PASS");
