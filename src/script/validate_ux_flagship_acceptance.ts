import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");
const exists = (file: string) => fs.existsSync(path.resolve(root, file));

const uxContract = read("../docs/LIOS_UX_SYSTEM.md");
const terminal = read("client/src/pages/Terminal.tsx");
const project = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const projectHome = read("client/src/components/terminal/ProjectHome.tsx");
const projectStyles = read("client/src/components/terminal/project-conversation-shell.css");
const publicPreview = read("client/src/pages/PublicProductPreview.tsx");
const signatureBackdrop = read("client/src/components/terminal/SignatureEntryBackdrop.tsx");
const signatureCss = read("client/src/signature-entry.css");
const globalCss = read("client/src/index.css");
const canvas = read("client/src/components/terminal/VisualCanvas.tsx");
const visual = read("client/src/lib/visualEnvironment.ts");
const visualCss = read("client/src/visual-intelligence-canvas.css");
const preferences = read("client/src/lib/terminalUxPreferences.ts");
const settings = read("client/src/components/terminal/TerminalUxSettings.tsx");
const sessions = read("client/src/lib/projectWorkspaceSession.ts");
const contracts = read("shared/projectContracts.ts");
const artifact = read("client/src/components/terminal/ArtifactPane.tsx");
const conversationContracts = read("shared/conversationRuntime.ts");
const conversationServer = read("server/conversationRuntime.ts");
const trace = read("client/src/components/terminal/ConversationRuntimeTrace.tsx");
const dockview = read("client/src/components/terminal/DockviewWorkspaceGrid.tsx");
const commands = read("client/src/components/terminal/CommandBar.tsx");
const contextRail = read("client/src/components/terminal/ContextRail.tsx");
const workspace = read("client/src/lib/terminalWorkspace.ts");
const navigation = read("client/src/components/terminal/AuthenticatedNavigation.tsx");
const workSearch = read("client/src/components/terminal/WorkSearchDialog.tsx");
const main = read("client/src/main.tsx");
const visualSmoke = read("client/src/visualSmoke.tsx");
const terminalStyles = read("client/src/terminalStyles.ts");
const visualSmokeCapture = read("script/visual_smoke_capture.cjs");
const analyticalVisualSmokeCapture = read("script/analytical_visual_smoke_capture.cjs");
const valuationVisualSmokeCapture = read("script/valuation_visual_smoke_capture.cjs");
const visualSmokeOutputSafety = read("script/prepare_visual_smoke_output.cjs");
const visualSmokeWorkflow = readQualificationWorkflow(path.resolve(root, ".."), "ux-visual-smoke.yml");

assert.ok(uxContract.includes("Projects → Chats → Artifacts"), "Canonical UX contract must define the Projects → Chats → Artifacts mental model.");
assert.ok(uxContract.includes("file attachment/import"), "Canonical UX contract must retain the composer attachment requirement.");
assert.ok(uxContract.includes("Contextual Visual Intelligence Canvas"), "Canonical UX contract must retain the visual canvas requirement.");
assert.ok(uxContract.includes("Supplied Figma Make reference"), "Canonical UX contract must identify the supplied Figma entry reference.");
assert.match(publicPreview, /Financial\s*<br\s*\/>\s*<span[^>]*>Intelligence<\/span>\s*<br\s*\/>\s*Operating\s*<br\s*\/>\s*System/, "Public entry must lead with the reference four-line Financial Intelligence Operating System hero.");
assert.ok(publicPreview.includes("lios-reference-entry") && publicPreview.includes('id="reference-demo"'), "Public entry must mount the reference shell and its illustrative terminal demo.");
assert.ok(publicPreview.includes("DEMO DATA") && /Not a live calculation or\s+source receipt/.test(publicPreview), "Sample prices and DCF grid must be clearly labelled illustrative, not live data or a source receipt.");
assert.ok(publicPreview.includes('matchMedia("(prefers-reduced-motion: reduce)")'), "Reference animation must respect reduced motion.");
assert.ok(!/Math\.random/.test(publicPreview), "Illustrative demo timing must be deterministic; the public preview must not sample random delays or figures.");
assert.ok(signatureBackdrop.includes("ROTATION_MS = 28_000"), "Entry rotation must remain slow and deliberate.");
assert.ok(signatureBackdrop.includes("prefers-reduced-motion: reduce"), "Signature entry must respect reduced motion.");
assert.ok(signatureBackdrop.includes("nextScene.path"), "Signature entry must preload only the likely next scene.");
assert.ok(signatureCss.includes("opacity 1800ms"), "Signature scene transition must remain cinematic rather than abrupt.");
assert.ok(globalCss.includes(".font-ui") && globalCss.includes("'Inter'"), "Conversational UI typography must use the bundled sans family.");
assert.ok(globalCss.includes(".font-terminal") && globalCss.includes("'JetBrains Mono'"), "Terminal data/metadata typography must retain the bundled mono family.");

assert.ok(terminal.includes("VisualCanvas"), "Terminal must mount the owned Visual Canvas.");
assert.ok(terminal.includes('data-visual-host="true"'), "Terminal must expose the single visual host.");
assert.ok(canvas.includes('data-intensity={intensity}'), "Visual Canvas must expose the three-state intensity.");
for (const state of ["immersive", "contextual", "focus"]) {
  assert.ok(visualCss.includes(`data-intensity="${state}"`), `Visual Canvas CSS missing ${state} state.`);
}
assert.ok(visualCss.includes("background-color: transparent !important"), "Visual host must explicitly override the matte host only at the owned canvas boundary.");
assert.ok(visual.includes("getProjectVisualEnvironmentPin"), "Project environment pinning is missing.");
assert.ok(visual.includes("previous?.projectId === normalized.projectId"), "Automatic Project environments must remain stable during active work.");

const environmentFiles = [
  "neutral.svg",
  "global-intelligence.svg",
  "company-intelligence.svg",
  "markets.svg",
  "valuation.svg",
  "portfolio-risk.svg",
  "quant-strategy.svg",
  "research-knowledge.svg",
  "personal-finance.svg",
  "economic-intelligence.svg",
];
for (const file of environmentFiles) {
  assert.ok(exists(`client/public/visual-environments/${file}`), `Missing production visual environment asset: ${file}`);
}

assert.ok(project.includes("<ProjectHome") && project.includes('from "./ProjectHome"'), "Project shell must mount the extracted Project Home surface.");
assert.ok(projectHome.includes("Start a conversation") && projectHome.includes('data-testid="project-saved-work"'), "Project Home must offer a clear Chat entry and an accessible saved-work disclosure.");
assert.ok(projectHome.includes("Research a company and show what changed"), "Project starter intents are missing.");
assert.ok(project.includes("dispatchVisualContext"), "Project/chat state must drive visual intensity.");
assert.ok(projectHome.includes("Environment · Auto"), "Project visual environment control is missing.");
assert.ok(projectHome.includes("Advanced tools"), "Advanced Project depth must remain accessible but collapsed initially.");
assert.ok(projectHome.includes("aria-expanded={projectDepthOpen}"), "Project depth reveal must expose accessible expanded state.");
assert.ok(project.includes("ArtifactPane"), "Persistent Artifacts must be able to open beside Project conversation.");
assert.ok(project.includes("lios-artifact-sidecar") && project.includes("w-[42%]"), "Conversation + Artifact split must size the side pane to the available surface.");
assert.ok(projectStyles.includes("container-type: inline-size") && projectStyles.includes("@container conversation (min-width: 900px)") && projectStyles.includes(".lios-artifact-sidecar { display: block; }"), "Artifact split must respond to the conversation container width.");
assert.ok(project.includes("width > 0 && width < 900") && project.includes("Exit Focus"), "Narrow Artifact Focus must provide an explicit return to chat.");
assert.ok(project.includes("setConversationArtifactRef(created.artifact.id)"), "Keeping a conversation Artifact must open the live Artifact surface.");
assert.ok(!terminal.includes("<MinimalProjectsHeader"), "Default Projects/chat must not render a duplicate global header.");
assert.ok(navigation.includes("Open workspace") && project.includes("Open workspace"), "Professional workspace depth must remain available on demand.");
assert.ok(navigation.includes("onSelect={props.onSettings}") && project.includes("onSettings={onOpenSettings}") && terminal.includes('onOpenSettings={() => openTerminalUxSurface("settings")}'), "Project navigation must expose Settings through the mounted terminal settings surface.");
assert.ok(project.includes("onOpenEnvironment"), "Conversation data-gap recovery must be able to open connector/environment setup directly.");

for (const key of ["visualEnvironmentsEnabled", "visualEnvironmentMotion", "lowResourceMode", "reducedMotion"]) {
  assert.ok(preferences.includes(key), `UX preference missing ${key}.`);
  assert.ok(settings.includes(`preferences.${key}`) || key === "reducedMotion", `Experience settings missing ${key}.`);
}

assert.ok(contracts.includes("visualEnvironment:"), "Project Session contract must persist visual continuity.");
assert.ok(sessions.includes("captureVisualEnvironmentState"), "Project Session capture must include the visual environment.");
assert.ok(sessions.includes("restoreVisualEnvironmentState"), "Project Session restore must restore the visual environment.");

assert.ok(artifact.includes("lios-artifact-frame"), "Artifact shell marker is missing.");
assert.ok(artifact.includes("Show Work"), "Artifact Show Work affordance is missing.");
assert.ok(artifact.includes("SOURCES"), "Artifact source indicator is missing.");
assert.ok(artifact.includes("executionReceiptIds"), "Artifact receipt visibility is missing.");

assert.ok(conversationContracts.includes('type: z.literal("data_gap")'), "Conversation contract must type structured data gaps.");
assert.ok(conversationServer.includes("ConversationDataGapError"), "Conversation Runtime must classify governed data gaps.");
assert.ok(conversationServer.includes("LiOS did not invent the missing observations"), "Data-gap path must state that LiOS did not fabricate observations.");
assert.ok(trace.includes("Data unavailable — no value invented"), "Conversation data-gap recovery UX is missing.");
assert.ok(trace.includes("onRecoveryAction"), "Data-gap actions must flow back to the composer.");

assert.ok(dockview.includes("DockviewReact"), "Living Workspace must retain Dockview as the single docking engine.");
assert.ok(commands.includes("parseFlexibleTerminalCommand"), "Universal command discovery must retain natural/flexible command parsing.");
assert.ok(project.includes("mentionCandidates"), "Project conversation must retain @ reference discovery.");
assert.ok(project.includes("QUICK_COMMANDS"), "Project conversation must retain slash-command discovery.");
assert.ok(project.includes('aria-label="Tools"') && project.includes('aria-label="Send"'), "Default composer must stay reduced to progressive add/tools and send controls.");
assert.ok(project.includes("Speak to LiOS") && !project.includes(">Set up voice<"), "Voice input must remain a single-icon composer affordance.");
assert.ok(workSearch.includes("Search chats, Projects, files and Artifacts"), "Saved-work Search must cover the user mental model instead of analytical tools.");
assert.ok(project.includes("DropdownMenuSubTrigger>Sources") && project.includes("DropdownMenuSubTrigger>Advanced"), "Advanced composer controls must remain available through progressive disclosure.");
assert.ok(project.includes("data-selection-aware-ai"), "Selection-aware conversational actions are missing.");
assert.ok(project.includes("policy.allowSelection"), "Active text selection must respect the Project transmission policy.");
assert.ok(project.includes("Context is staged locally in the composer"), "Selection-aware UX must make local staging explicit.");
assert.ok(project.includes("ConversationArtifactPane = lazy"), "Conversation Artifact work must lazy-load the heavy Artifact surface.");
assert.ok(project.includes("setConversationArtifactRef(null)"), "Conversation Artifact state must be clearable and isolated across navigation.");
assert.ok(project.includes('data-selection-aware-ai="true"'), "Selection-aware AI action bar is missing.");
for (const label of ["Explain", "Compare", "Model", "Show source", "Create alert", "Add to report", "Ask about this"]) {
  assert.ok(project.includes(`label: "${label}"`), `Selection-aware action missing: ${label}`);
}
assert.ok(project.includes("nothing is sent until you submit"), "Selection-aware AI must remain user-controlled and non-transmitting until submit.");
assert.ok(contextRail.includes("HIGH-VALUE ACTIONS"), "Contextual next-best-action rail is missing.");
assert.ok(contextRail.includes("getContextHeroActions"), "Contextual next actions must be resolved from the active analytical view.");
assert.ok(contracts.includes('"personal-finance"'), "Personal Finance must be available through governed workspace proposals.");
assert.ok(workspace.includes('"PERSONAL FINANCE"'), "Personal Finance must be a first-class Living Workspace composition.");
assert.ok(projectHome.includes("Plan personal finances and long-term goals"), "Project Home must surface Personal Finance as a first-class intent.");

assert.ok(visualCss.includes("lios-environment-drift"), "Restrained environment motion is missing.");
assert.ok(visualCss.includes('data-reduced-motion="true"'), "Reduced-motion override is missing.");
assert.ok(visualCss.includes('data-low-resource-mode="true"'), "Low-resource visual fallback is missing.");
assert.ok(visualCss.includes("backdrop-filter: none !important"), "Low-resource mode must remove expensive material blur.");
assert.ok(visualCss.includes("lios-conversation-composer"), "Composer material treatment is missing.");
assert.ok(main.includes('import "./terminalStyles";'), "Production must use the canonical shared terminal stylesheet entry.");
const shellIndex = terminalStyles.indexOf('import "./terminal-shell.css";');
const canvasIndex = terminalStyles.indexOf('import "./visual-intelligence-canvas.css";');
assert.ok(shellIndex >= 0 && canvasIndex > shellIndex, "The explicit Visual Canvas must load after canonical shell arbitration without reopening legacy backgrounds.");

for (const smokeCase of ["project-home", "conversation", "conversation-artifact", "workspace-focus"]) {
  assert.ok(visualSmoke.includes(`"${smokeCase}"`), `Flagship visual smoke case missing: ${smokeCase}`);
  assert.ok(visualSmokeCapture.includes(`"${smokeCase}`), `Desktop capture case missing: ${smokeCase}`);
}
assert.ok(visualSmoke.includes('import "./terminalStyles";') && terminalStyles.includes('import "./visual-intelligence-canvas.css";'), "Visual smoke must use the same production stylesheet entry and visual canvas layer.");
assert.ok(visualSmokeWorkflow.includes('test "$ux_png_count" -eq 15'), "Visual smoke workflow must validate all 15 UX screenshots.");
assert.ok(visualSmokeWorkflow.includes("m.cases.length !== 15"), "Visual smoke workflow must validate the 15-case UX manifest.");
for (const [name, capture] of [
  ["UX", visualSmokeCapture],
  ["analytical", analyticalVisualSmokeCapture],
  ["valuation", valuationVisualSmokeCapture],
]) {
  assert.ok(capture.includes("prepareVisualSmokeOutput"), `${name} visual smoke must use the safe output initializer.`);
  assert.ok(!capture.includes("rmSync(outputDir"), `${name} visual smoke must not delete prior evidence.`);
}
assert.ok(visualSmokeOutputSafety.includes("Refusing to overwrite existing visual-smoke output"), "Visual smoke must preserve existing evidence directories.");

console.log(JSON.stringify({
  program: "LiOS UI/UX",
  evidence: {
    staticSourceContract: "PASS",
    visualEnvironmentAssetPresence: "PASS",
    interactiveQA: "REQUIRED_NOT_RUN",
    packagedDesktopQA: "REQUIRED_NOT_RUN",
  },
  visualCanvas: {
    environments: environmentFiles.length,
    states: ["immersive", "contextual", "focus"],
    projectPinning: true,
    sessionRestore: true,
    reducedMotion: true,
    lowResource: true,
    visualSmokeCases: 15,
  },
  projectExperience: {
    conversationFirst: true,
    starterIntents: true,
    progressiveWorkspace: true,
    selectionAwareAi: true,
    contextualNextActions: true,
  },
  artifacts: {
    sharedFrame: true,
    showWork: true,
    sourceReceiptIndicators: true,
    conversationSplit: true,
    lazyLoaded: true,
  },
  livingWorkspace: {
    engine: "dockview",
    governedAssistantActions: true,
    personalFinanceComposition: true,
    selectionAwareConversation: true,
  },
  trust: {
    structuredDataGap: true,
    noFabricatedFallback: true,
  },
  visualSmokeCases: ["project-home", "conversation", "conversation-artifact", "workspace-focus"],
}, null, 2));
