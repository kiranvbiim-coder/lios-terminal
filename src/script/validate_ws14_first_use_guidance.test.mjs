import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = new URL("../client/src/", import.meta.url);
const read = name => fs.readFileSync(new URL(name, base), "utf8");
const shell = read("components/terminal/ProjectExperienceShell.tsx");
const first = read("lib/firstUseJourney.ts");
const finance = read("lib/projectExperienceVisualState.ts");
const app = read("App.tsx");
const center = read("pages/DataConnectionCenter.tsx");

test("WS-14 original authenticated Chat remains the single surface, no mandatory setup or duplicate runtime", () => {
  assert.match(app, /<AppRouter[\s\S]*?onOpenEnvironment=\{\(\) => setEnvironmentSetupOpen\(true\)\}/);
  assert.match(app, /data-lios-workspace hidden=\{environmentSetupOpen \|\| domainPickerOpen\}/);
  assert.match(app, /<DataConnectionCenter session=\{session\}/);
  assert.doesNotMatch(first, /apiRequest|fetch\(|createQuickChat|createProjectChat/);
  assert.match(first, /connectionsRequiredToEnter: false/);
  assert.match(first, /primaryAction: "ask"/);
});

test("WS-14 welcome speaks to universal tasks first, finance remains available but not the only entry", () => {
  assert.match(shell, /LiOS · Ask anything/);
  assert.doesNotMatch(shell, /LiOS · Financial intelligence/);
  assert.match(shell, /\[\.\.\.FIRST_USE_UNIVERSAL_STARTERS, \.\.\.PROJECT_STARTER_PROMPTS\]\.map/);
  assert.match(shell, /"General" : "Finance specialist"/);
  assert.match(shell, /aria-label="General and specialist example prompts"/);
  assert.match(finance, /id: "deterministic-valuation"/);
  assert.match(first, /id: "explain-any-topic"/);
  assert.match(first, /id: "plan-a-project"/);
  assert.match(first, /id: "explore-an-idea"/);
});

test("WS-14 first task is a deliberate Ask action, not an automatic send or required Project", () => {
  assert.match(shell, /data-first-use-primary="ask"/);
  assert.match(shell, /onClick=\{\(\) => composerRef\.current\?\.focus\(\)\}/);
  assert.match(shell, /Create a Project/);
  assert.match(shell, /data-first-use-connect="optional"/);
  assert.match(shell, /\{LIOS_FIRST_USE_CONTRACT\.optionalConnectionAction\}/);
  assert.match(shell, /data-first-use-entry="ask-first"/);
  assert.match(shell, /aria-label="Ask LiOS"/);
});

test("WS-14 selecting an example edits the existing composer and selects a placeholder, never calls a provider", () => {
  assert.match(shell, /const prompt = fillStarterPrompt\(starter\.prompt, recentStarterSymbol\)/);
  assert.match(shell, /setInput\(prompt\)/);
  assert.match(shell, /const placeholder = findStarterPlaceholder\(prompt\)/);
  assert.match(shell, /composer\.setSelectionRange\(placeholder\.start, placeholder\.end\)/);
  assert.match(shell, /requestAnimationFrame\(\(\) => \{[\s\S]*?const composer = composerRef\.current/);
  assert.doesNotMatch(first, /window\.dispatchEvent|localStorage|useGateway|providerCredential/);
});

test("WS-14 missing AI and connection recovery use the existing preserved-task setup surface", () => {
  assert.match(shell, /if \(firstUseRecoveryDestination\(action\) === "connections"\)/);
  assert.match(shell, /if \(lastSubmittedMessage\.trim\(\)\)/);
  assert.match(shell, /setInput\(lastSubmittedMessage\)/);
  assert.match(shell, /onOpenEnvironment\(\)/);
  assert.match(shell, /setInput\(action\)/);
  assert.match(first, /configure ai/);
  assert.match(first, /open connection center/);
  assert.match(center, /onComplete:/);
});

test("WS-14 guided welcome does not claim AI is ready or invent provider/source capabilities", () => {
  assert.match(first, /show unavailable evidence or capabilities rather than invent an answer/);
  assert.match(first, /Sources and AI are optional to configure now/);
  assert.doesNotMatch(first, /AI is ready|live data enabled|all providers connected|always available/);
  assert.match(shell, /<BoundedAgentComposerControl agent=\{agentComposer\} busy=\{busy\} onConfigureAI=\{onOpenEnvironment\}/);
  assert.match(shell, /<ChatSourcesControl scope=\{sourceScope\}/);
});

test("WS-14 existing finance examples still ask for evidence and explicit user-provided private data", () => {
  assert.match(finance, /using available, cited sources/);
  assert.match(finance, /ask me before estimating anything that is unavailable/);
  assert.match(finance, /Ask me to select the file or source before using private data/);
  assert.match(finance, /export function findStarterPlaceholder/);
});

test("WS-14 documented real-world acceptance is not silently treated as executed", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS14_UNIVERSAL_FIRST_USE_GUIDANCE_2026-10-23.md", import.meta.url), "utf8");
  assert.match(doc, /#99/);
  assert.match(doc, /#102/);
  assert.match(doc, /#105/);
  assert.match(doc, /200% zoom[\s\S]{0,90}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,90}NOT_RUN/);
});
