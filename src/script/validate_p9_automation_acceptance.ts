import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const contracts = read("shared/p9AutomationContracts.ts");
const schema = read("shared/schemaAutomation.ts");
const migration = read("migrations/0071_lios_p9_automation_continuous_intelligence.sql");
const journal = read("migrations/meta/_journal.json");
const engine = read("server/p9AutomationEngine.ts");
const store = read("server/p9AutomationStore.ts");
const service = read("server/p9AutomationService.ts");
const routes = read("server/p9AutomationRoutes.ts");
const routeRegistry = read("server/routes.ts");
const index = read("server/index.ts");
const sourceRoutes = read("server/sourceConnectionRoutes.ts");
const decisionMonitor = read("server/decisionMonitor.ts");
const alertMonitor = read("server/alertMonitor.ts");
const projectShell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const panel = read("client/src/components/terminal/ProjectAutomationPanel.tsx");
const saveDialog = read("client/src/components/terminal/SaveWorkflowDialog.tsx");
const client = read("client/src/lib/useP9Automation.ts");
const packageJson = read("package.json");
const workflow = readQualificationWorkflow(path.resolve(root, ".."), "lios-hardening.yml");
const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const plan = read("../docs/technical/P9_AUTOMATION_CONTINUOUS_INTELLIGENCE.md");
const p8Acceptance = read("script/validate_p8_scenario_acceptance.ts");

assert.ok(routeRegistry.includes("registerP8Routes(app)") && p8Acceptance.includes('routeRegistry.includes("registerP8Routes(app)")'), "P8 central route registration regression is not protected.");
assert.ok(routeRegistry.includes("registerP9AutomationRoutes(app)"), "P9 automation routes are not centrally registered.");
assert.ok(routes.includes("await getProject(ctx(req), pid)") && routes.includes("markP9NotificationRead(ctx(req), pid"), "P9 Project-boundary checks are missing from automation runtime/notification routes.");

assert.ok(
  contracts.includes("p9WorkflowTriggerSchema") &&
  contracts.includes("p9WorkflowActionSchema") &&
  contracts.includes("p9NotificationPolicySchema") &&
  schema.includes("projectAutomationWorkflows") &&
  schema.includes("projectAutomationRuns") &&
  schema.includes("projectAutomationNotifications") &&
  migration.includes('ENABLE ROW LEVEL SECURITY'),
  "P9-01 durable tenant-scoped workflow/run/notification contract missing.",
);
assert.ok(service.includes("startP9AutomationRuntime") && store.includes("claimDueP9Workflows") && store.includes("claimExpiresAt"), "P9-01 restart-safe scheduler/lease path missing.");
assert.ok(store.includes("renewP9WorkflowClaimSystem") && service.includes("workflow claim heartbeat"), "P9-01 long-running scheduler claim heartbeat missing.");

assert.ok(
  routes.includes("/automation/save-conversation") &&
  saveDialog.includes("Save Workflow") &&
  client.includes("saveConversationAsP9Workflow") &&
  contracts.includes('"manual"') &&
  contracts.includes('"schedule"') &&
  contracts.includes('"event"'),
  "P9-02 Conversation → Save Workflow / manual / schedule / event path missing.",
);

for (const token of ["filing_monitor","earnings_monitor","valuation_refresh","portfolio_monitor","provider_health"]) {
  assert.ok(contracts.includes(token), "P9-03 canonical monitor/template missing " + token + ".");
}
assert.ok(service.includes("runThesisRefresh") && service.includes("runProviderHealth") && service.includes("runConversationRerun"), "P9-03 canonical workflow executors missing.");

assert.ok(
  contracts.includes('channels: z.array(z.enum(["in_app"]))') &&
  contracts.includes("minimumRelevanceScore") &&
  contracts.includes("cooldownMinutes") &&
  migration.includes("project_automation_notifications") &&
  panel.includes("IN-APP ONLY"),
  "P9-04 explicit Project-scoped notification routing missing.",
);

assert.ok(
  routes.includes("visualEditor") && routes.includes("enabled: false") &&
  panel.includes("Visual workflow editing is not available.") && panel.includes("Save Workflow") &&
  saveDialog.includes("Save Workflow"),
  "P9-05 simple Save Workflow first / deferred visual editor contract missing.",
);

for (const eventType of ["filing","earnings","data_refresh","price_threshold","risk_threshold","provider_health"]) {
  assert.ok(contracts.includes('"' + eventType + '"'), "P9-06 event type missing " + eventType + ".");
}
assert.ok(
  index.includes('eventType: "data_refresh"') &&
  index.includes('eventType: "price_threshold"') &&
  decisionMonitor.includes('eventType: "risk_threshold"') &&
  sourceRoutes.includes('eventType: "provider_health"') &&
  alertMonitor.includes("onTriggered"),
  "P9-06 existing event-source bridges missing.",
);
assert.ok(service.includes("eventDedupeKey") && schema.includes("project_automation_runs_dedupe_unique"), "P9-06 event idempotency missing.");
assert.ok(service.includes("runP9FilingObserverCycle") && schema.includes("eventCursor") && migration.includes('"event_cursor" jsonb'), "P9-06 durable SEC filing observer cursor missing.");
assert.ok(service.includes("publishP9EarningsObserved") && routes.includes("waiting_for_verified_provider"), "P9-06 earnings provider adapter/readiness boundary missing.");

for (const template of ["thesis_refresh","valuation_refresh","portfolio_monitor","provider_health","report_refresh"]) {
  assert.ok(contracts.includes('template: "' + template + '"') || contracts.includes('"' + template + '"'), "P9-07 canonical workflow template missing " + template + ".");
}
assert.ok(contracts.includes("P9_CANONICAL_WORKFLOW_TEMPLATES"), "P9-07 canonical template registry missing.");

for (const refField of ["sourceRefs","engineRefs","artifactRefs","executionReceiptIds"]) {
  assert.ok(schema.includes(refField) && service.includes(refField), "P9-08 reproducibility reference missing " + refField + ".");
}
assert.ok(service.includes("createConversationLedgerRecorder") && store.includes('eventType: "execution.receipt"'), "P9-08 P3 Ledger/reproducibility convergence missing.");
assert.ok(service.includes("requireMasterAiOn") && service.includes("plan.intent.requiresAI"), "P9 saved workflows do not re-check the current Master AI permission state.");

assert.ok(
  engine.includes("decideP9Notification") &&
  contracts.includes("minimumRelevanceScore") &&
  contracts.includes("suppressUnchanged") &&
  contracts.includes("cooldownMinutes") &&
  engine.includes("Notification cooldown is still active"),
  "P9-09 low-noise relevance/threshold/cooldown policy missing.",
);

assert.ok(projectShell.includes("ProjectAutomationPanel") && projectShell.includes("SaveWorkflowDialog"), "P9 Project Home/chat UX wiring missing.");
assert.ok(projectShell.includes("lastWorkflowRequest") && projectShell.includes('grant.scope === "project"'), "P9 Save Workflow does not snapshot the exact governed request/project-scoped approvals.");
const artifactPane = read("client/src/components/terminal/ArtifactPane.tsx");
assert.ok(artifactPane.includes("Monitor Thesis") && artifactPane.includes("thesis_refresh"), "P9 native Thesis monitor UX missing.");
assert.ok(panel.includes("Run now") && panel.includes("Pause workflow") && panel.includes("Resume workflow"), "P9 workflow control UX missing.");
assert.ok(packageJson.includes('"test:p9"') && packageJson.includes('"acceptance:p9"'), "P9 package test/acceptance scripts missing.");
assert.ok(workflow.includes("P9 Automation and continuous intelligence acceptance"), "P9 phase-end CI gate missing.");
assert.ok(workflow.includes("server/p9RlsLive.test.ts"), "P9 live Postgres RLS test is missing from the tenant-isolation gate.");

const parsedJournal = JSON.parse(journal) as { entries: Array<{ idx: number; tag: string }> };
const p9Entry = parsedJournal.entries.find((entry) => entry.tag === "0071_lios_p9_automation_continuous_intelligence");
assert.equal(p9Entry?.idx, 71, "P9 migration journal entry drifted.");
const lifecycleEntry = parsedJournal.entries.find((entry) => entry.tag === "0072_lios_ux_lifecycle_trash");
assert.equal(lifecycleEntry?.idx, 72, "Lifecycle migration journal entry drifted.");
assert.ok(parsedJournal.entries.at(-1)!.idx >= 72, "Migration journal must not be behind the lifecycle migration.");

for (let id = 1; id <= 9; id += 1) {
  const taskId = "LIOS-P9-" + String(id).padStart(2, "0");
  const roadmapRows = roadmap.split("\n").filter((line) => line.startsWith("| " + taskId + " |")).length;
  assert.equal(roadmapRows, 1, "Roadmap must contain exactly one canonical row for " + taskId + ".");
  assert.ok(plan.includes(taskId), "P9 technical source of truth missing " + taskId + ".");
}

console.log("P9 Automation & Continuous Intelligence acceptance P9-01…P9-09: PASS");
