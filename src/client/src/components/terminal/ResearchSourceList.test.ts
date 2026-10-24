import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ResearchSourceList, { inspectableSourceHref } from "./ResearchSourceList";
import { collectCitationSources, type ChatCitationSource } from "@/lib/chatMarkdown";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const toolResult = (refs: string[]) => ({
  type: "tool_result", requestId: REQUEST_ID, at: "2026-10-22T12:00:00Z",
  stepId: "research", label: "Research", summary: "Source results", deterministic: true,
  sourceRefs: refs,
}) as unknown as ConversationRuntimeEvent;

test("source inspection uses only references actually recorded by runtime events", () => {
  const sources = collectCitationSources([
    toolResult(["provider:sec_edgar", "https://example.com/report", "https://example.com/report", "engine:dcf"]),
  ]);
  assert.deepEqual(sources.map((s) => s.id), ["provider:sec_edgar", "https://example.com/report"]);
  assert.equal(inspectableSourceHref(sources[0]), null);
  assert.equal(inspectableSourceHref(sources[1]), "https://example.com/report");
});

test("never make inferred, credentialed, mailto, or unsafe provider references clickable", () => {
  const samples: ChatCitationSource[] = [
    { id: "provider:sec_edgar", label: "SEC EDGAR", href: "https://www.sec.gov/" },
    { id: "https://user:secret@example.com/", label: "Credential URL", href: "https://user:secret@example.com/" },
    { id: "javascript:alert(1)", label: "Danger", href: "javascript:alert(1)" },
    { id: "mailto:user@example.com", label: "Email", href: "mailto:user@example.com" },
    { id: "https://example.com", label: "Verified", href: "https://example.com/" },
  ];
  assert.deepEqual(samples.map(inspectableSourceHref), [null, null, null, null, "https://example.com/"]);
  const markup = renderToStaticMarkup(createElement(ResearchSourceList, { sources: samples }));
  assert.equal((markup.match(/<a\b/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /href="javascript|href="mailto|href="https:\/\/user/);
  assert.match(markup, /target="_blank" rel="noopener noreferrer"/);
  assert.match(markup, /Reference only · no verified link/);
});

test("show work source list keeps all references accessible via expandable disclosure", () => {
  const sources: ChatCitationSource[] = Array.from({ length: 9 }, (_, i) => ({
    id: `provider:source_${i + 1}`, label: `Source ${i + 1}`,
  }));
  const markup = renderToStaticMarkup(createElement(ResearchSourceList, { sources }));
  assert.match(markup, /data-testid="trace-sources"/);
  assert.match(markup, /Recorded source references \(9\)/);
  assert.match(markup, /data-testid="trace-sources-expand"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, />Show all 9 sources<\/button>/);
  assert.equal((markup.match(/<li\b/g) ?? []).length, 6);
  assert.doesNotMatch(markup, /Source 7/);
  const componentSource = requireSource();
  assert.match(componentSource, /onClick=\{\(\) => setExpanded\(\(current\) => !current\)\}/);
  assert.match(componentSource, /expanded \? sources : sources\.slice\(0, INITIAL_VISIBLE\)/);
});

test("the full evidence catalog is capped truthfully and empty list has no chrome", () => {
  const refs = Array.from({ length: 60 }, (_, i) => `provider:source_${i}`);
  const sources = collectCitationSources([toolResult(refs)]);
  assert.equal(sources.length, 50);
  const markup = renderToStaticMarkup(createElement(ResearchSourceList, { sources }));
  assert.match(markup, /Showing up to 50 recorded source references/);
  assert.equal(renderToStaticMarkup(createElement(ResearchSourceList, { sources: [] })), "");
});

function requireSource(): string {
  // Source-contract assertion complements SSR without a browser or new test runner.
  return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ResearchSourceList.tsx"), "utf8");
}

test("WS-29: the inline citation safety policy is identical to the inspector policy", () => {
  const forged: ChatCitationSource = {
    id: "provider:sec_edgar", label: "SEC EDGAR", href: "https://www.sec.gov/",
    index: 2,
  };
  assert.equal(inspectableSourceHref(forged), null);
  const altered: ChatCitationSource = {
    id: "https://example.org/research/actual", label: "Wrong destination",
    href: "https://example.org/research/other", index: 3,
  };
  assert.equal(inspectableSourceHref(altered), null);
  const exact: ChatCitationSource = {
    id: "https://example.org/research/actual", label: "Recorded document",
    href: "https://example.org/research/actual", index: 4,
  };
  assert.equal(inspectableSourceHref(exact), "https://example.org/research/actual");
  const markup = renderToStaticMarkup(createElement(ResearchSourceList, { sources: [forged, altered, exact] }));
  assert.equal((markup.match(/<a\b/g) ?? []).length, 1);
  assert.match(markup, /Reference only · no verified link/);
});

test("WS-29: source evidence is request-bound, not inherited from another run or an earlier plan", () => {
  const OTHER_ID = "22222222-2222-4222-8222-222222222222";
  const plan = (id: string) => ({
    type: "plan", requestId: id, at: "2026-10-24T10:00:00Z",
    plan: { schemaVersion: "1", requestId: id, capabilities: [], steps: [] },
  }) as unknown as ConversationRuntimeEvent;
  const foreign = {
    ...toolResult(["https://example.org/foreign"]), requestId: OTHER_ID,
  };
  const events = [
    plan(REQUEST_ID),
    toolResult(["https://example.org/old"]),
    foreign,
    plan(REQUEST_ID),
    toolResult(["provider:fred", "https://example.org/latest"]),
    foreign,
  ];
  assert.deepEqual(collectCitationSources(events, REQUEST_ID).map(source => source.id), [
    "provider:fred", "https://example.org/latest",
  ]);
  assert.deepEqual(collectCitationSources(events, OTHER_ID).map(source => source.id), [
    "https://example.org/foreign",
  ]);
  assert.deepEqual(collectCitationSources(events, "33333333-3333-4333-8333-333333333333"), []);
  assert.deepEqual(collectCitationSources(events).map(source => source.id), [
    "provider:fred", "https://example.org/latest",
  ]);
});

test("WS-29: a trust record from a mismatched manifest cannot launder foreign document references", () => {
  const OTHER_ID = "22222222-2222-4222-8222-222222222222";
  const trust = ({
    type: "trust", requestId: REQUEST_ID, at: "2026-10-24T10:00:00Z",
    manifest: {
      requestId: OTHER_ID,
      evidence: [{ sourceRef: "https://example.org/foreign-trust", providerLabel: "Foreign" }],
    },
  }) as unknown as ConversationRuntimeEvent;
  assert.deepEqual(collectCitationSources([toolResult(["provider:fred"]), trust], REQUEST_ID).map(s => s.id), ["provider:fred"]);
});
