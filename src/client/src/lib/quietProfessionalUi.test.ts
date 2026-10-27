import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const project = read("../components/terminal/ProjectHome.tsx");
const shell = read("../components/terminal/ProjectExperienceShell.tsx");
const trace = read("../components/terminal/ConversationRuntimeTrace.tsx");
const css = read("../lios-product-experience.css");

test("Project Home presents a single Chat entry before saved work and advanced features", () => {
  const start = project.indexOf("Start a conversation");
  const saved = project.indexOf('data-testid="project-saved-work"');
  const advanced = project.indexOf('aria-expanded={projectDepthOpen}');
  assert.ok(start > 0 && start < saved && saved < advanced);
  assert.match(project, /<details[^>]*data-testid="project-saved-work"/);
  assert.match(project, /<summary[^>]*>Saved work<\/summary>/);
  assert.match(project, /<details[^>]*data-testid="project-options"/);
  assert.match(project, /<summary[^>]*>Project options<\/summary>/);
  assert.match(project, /<summary[^>]*>Saved work<\/summary>/);
  assert.match(project, /<span[^>]*>Advanced tools<\/span>/);
  assert.doesNotMatch(project, /FORKABLE ANALYTICAL STATE|Keep this Project focused/);
});

test("Project disclosures retain meaningful permissions, resource actions and failure notices", () => {
  assert.match(project, /project\.instructions &&/);
  assert.match(project, /value=\{environmentId\}/);
  assert.match(project, /onClick=\{onOpenContext\}/);
  assert.match(project, /onClick=\{onOpenWorkbench\}/);
  assert.match(project, /onClick=\{onNewChat\}/);
  assert.match(project, /Review context inclusion/);
  assert.match(project, /Source permissions still apply/);
  assert.match(project, /aria-expanded=\{projectDepthOpen\}/);
  const error = project.indexOf("{collectionsFailed &&");
  const details = project.indexOf('data-testid="project-saved-work"');
  assert.ok(error > 0 && error < details, "A failed Project collections read must remain visible before collapsed work");
  assert.match(project, /role="alert"/);
});

test("Chat's default surface has one concise question and optional first-use actions", () => {
  const empty = shell.slice(
    shell.indexOf('className="lios-conversation-empty-state'),
    shell.indexOf("{hiddenMessageCount > 0"),
  );
  assert.ok(empty.includes("How can I help?"));
  assert.doesNotMatch(empty, /What do you want to understand, test or build\?|Start with the question/);
  assert.match(empty, /className="lios-chat-starters/);
  assert.match(empty, /aria-label=\{\`Use example: \$\{starter\.label\}\`\}/);
  assert.match(empty, /data-first-use-primary="ask"/);
  assert.match(empty, /<details className="lios-first-use-options/);
  assert.match(empty, /<summary[^>]*>More options<\/summary>/);
  assert.match(empty, /data-first-use-connect="optional"/);
  assert.match(empty, /LIOS_FIRST_USE_CONTRACT\.shellHint/);
});

test("Run status stays quiet but stop, work evidence and all urgent recovery/approval remain available", () => {
  assert.match(trace, /waitingForApproval \? "Waiting for your approval" : "Working"/);
  assert.match(trace, /data-testid="agent-run-cancel"/);
  assert.match(trace, /data-testid="trace-show-work"/);
  assert.match(trace, /ResearchRunProgress events=\{events\} requestId=\{requestId\} view="findings"/);
  assert.doesNotMatch(trace, /ResearchRunProgress events=\{events\} requestId=\{requestId\} view="inline"/);
  for (const essential of ["trace-agent-receipt-warning", "trace-data-gap", "trace-error", "trace-interrupted"]) {
    assert.ok(trace.includes(essential), essential + " must not be hidden by minimal UI");
  }
  assert.match(trace, /onGovernedToolReview|onApprove/);
});

test("Secondary action affordances are keyboard accessible and remain visible on touch", () => {
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /lios-conversation-message:focus-within \[data-testid="chat-message-actions"\]/);
  assert.match(css, /lios-conversation-message:hover \[data-testid="chat-message-actions"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\[role="alert"\][\s\S]{0,90}display:\s*none/);
});
