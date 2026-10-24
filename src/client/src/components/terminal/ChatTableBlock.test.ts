import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMarkdown from "./ChatMarkdown";
import type { ChatCitationSource } from "@/lib/chatMarkdown";

const markdown = (text: string, streaming = false, sources?: ChatCitationSource[]) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text, streaming, sources }));
const TABLE = "| Metric | Value | Source |\n|:---|---:|:---|\n| EPS | -3.25 | [1] |";

test("WS-23 table has semantic headings, accessible caption and keyboard scroll", () => {
  const markup=markdown(TABLE);
  assert.match(markup,/data-chat-table-block="true"/);
  assert.match(markup,/<caption class="sr-only">Answer table with 3 columns and 1 data rows/);
  assert.match(markup,/<th scope="col"/);
  assert.match(markup,/role="region" tabindex="0" aria-label="Scrollable answer table"/);
  assert.match(markup,/text-right[^>]*>-3\.25<\/td>/);
});
test("WS-23 wide table Copy button describes safe spreadsheet format and is focusable", () => {
  const markup=markdown(TABLE);
  assert.match(markup,/type="button"[^>]*aria-label="Copy table as tab-separated text"/);
  assert.match(markup,/data-testid="chat-table-copy"/);
  assert.match(markup,/focus-visible:ring-2/);
  assert.match(markup,/role="status" aria-live="polite"/);
});
test("WS-23 streaming table cannot copy a half-finished response", () => {
  const markup=markdown(TABLE+"\n| Partial |",true);
  assert.match(markup,/aria-label="Copy table after the answer finishes"/);
  assert.match(markup,/disabled=""/);
  assert.match(markup,/Generating…/);
});
test("WS-23 unresolved citation stays literal, not manufactured as a link in table", () => {
  const markup=markdown(TABLE);
  assert.match(markup,/>\[1\]<\/td>/);
  assert.doesNotMatch(markup,/data-citation=/);
});
test("WS-23 exact runtime-authorized source can be cited inside table and remains keyboard focusable", () => {
  const sources:ChatCitationSource[]=[{id:"provider:sec_edgar",label:"SEC EDGAR",index:1}];
  const markup=markdown(TABLE,false,sources);
  assert.match(markup,/aria-label="Source 1: SEC EDGAR"/);
  assert.match(markup,/data-citation="1"/);
});
test("WS-23 unsafe HTML and links inside table stay escaped/inert", () => {
  const markup=markdown("| Label | Value |\n|---|---|\n| <script>alert(1)</script> | [bad](javascript:alert(1)) |");
  assert.doesNotMatch(markup,/<script\b|href="javascript:|<iframe\b/);
  assert.match(markup,/&lt;script&gt;/);
  assert.match(markup,/>bad<\/td>/);
});
test("WS-23 code-copy ownership from PR #113 stays intact alongside tables", () => {
  const markup=markdown(TABLE+"\n\n```ts\nconst x = 1 < 2;\n```");
  assert.match(markup,/data-chat-table-block="true"/);
  assert.match(markup,/data-chat-code-block="true"/);
  assert.match(markup,/aria-label="Copy ts code"/);
});
test("WS-23 table failed copy has manual fallback; no false clipboard success by default", () => {
  const markup=markdown(TABLE);
  assert.doesNotMatch(markup,/>Copied<\/button>/);
  assert.match(markup,/>Copy table<\/button>/);
});
