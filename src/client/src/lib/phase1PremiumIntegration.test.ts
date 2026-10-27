import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discoverChatTools } from "./chatToolDiscovery";
import { recordedCitationHref } from "./chatMarkdown";
import { pulseStoryQuestion, safePulseSourceUrl } from "./pulseStoryPresentation";

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("Phase 1 sources are kept intact from Pulse through Chat and evidence", () => {
  const shell = source("../components/terminal/WaveCExperienceShell.tsx");
  const board = source("../components/terminal/FusionPulseBoard.tsx");
  const story = source("../components/terminal/LiosPulseStoryCard.tsx");
  assert.match(shell, /useState<IntelligenceCard\[\]>/);
  assert.match(board, /<LiosPulseStoryCard/);
  assert.match(story, /safePulseSourceUrl\(source\.url\)/);
  assert.match(story, /onAsk\(pulseStoryQuestion\(card\)\)/);
  assert.match(story, /Sources not attached/);
  assert.equal(safePulseSourceUrl("javascript:alert(1)"), null);
  assert.match(pulseStoryQuestion({
    id: "case-1", title: "Evidence-backed research",
    whatHappened: "Observed record", priority: "important", score: 75,
  }), /Verify its claims against available sources/);
});

test("inline Chat citations and expanded source cards cannot promote provider handles into observed-document links", () => {
  const inline = source("../components/terminal/ChatMarkdown.tsx");
  const sourceList = source("../components/terminal/ResearchSourceList.tsx");
  assert.match(inline, /recordedCitationHref\(source\)/);
  assert.match(sourceList, /inspectableSourceHref = recordedCitationHref/);
  assert.equal(recordedCitationHref({ id: "provider:research", href: "https://example.com", label: "Research", index: 1 }), null);
  assert.equal(recordedCitationHref({ id: "https://example.com/report", href: "https://example.com/report", label: "Report", index: 2 }), "https://example.com/report");
  assert.equal(recordedCitationHref({ id: "https://a.com", href: "https://b.com", label: "Mismatch", index: 3 }), null);
});

test("Chat Views stays cross-domain, audience-scoped and separate from composer Tools", () => {
  const launcher = source("../components/terminal/ChatTerminalSurface.tsx");
  const composer = source("../components/terminal/ProjectExperienceShell.tsx");
  assert.match(launcher, />Views</);
  assert.doesNotMatch(launcher, />Finance terminal</);
  assert.match(composer, /<ChatTerminalControl audience=\{audience\}/);
  assert.match(composer, /aria-label="Tools"/);
  assert.ok(discoverChatTools("client", "valuation").some(group => group.tools.some(t => t.view === "valuation")));
  assert.ok(!discoverChatTools("trial", "integratedmodel").some(group => group.tools.some(t => t.view === "integratedmodel")));
});

test("real agent action receipts remain inspectable and no parallel approval mechanism is created", () => {
  const trace = source("../components/terminal/ConversationRuntimeTrace.tsx");
  const receipts = source("../components/terminal/AgentExecutionReceipts.tsx");
  assert.match(trace, /<AgentExecutionReceipts activity=\{activity\} \/>/);
  assert.match(trace, /reviewTool\("allow_once"\)/);
  assert.match(trace, /reviewTool\("deny"\)/);
  assert.match(receipts, /receiptPresentation\(receipt\)/);
  assert.match(receipts, /Receipts do not grant approval or prove an external action occurred/);
  assert.doesNotMatch(receipts, /receipt\.inputEvidence|receipt\.outputEvidence|receipt\.warnings\[/);
  // Quiet Chat remains quiet unless the user requests execution detail.
  assert.doesNotMatch(trace, /<ResearchRunProgress events=\{events\} requestId=\{requestId\} view="inline"/);
});
