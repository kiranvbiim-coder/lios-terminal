import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  return fs.readFileSync(path.join(__dirname, "ResearchSourceList.tsx"), "utf8");
}
