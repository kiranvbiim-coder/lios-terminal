import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../client/src/", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), "utf8");
const markdown = read("components/terminal/ChatMarkdown.tsx");
const code = read("components/terminal/ChatCodeBlock.tsx");
const table = read("components/terminal/ChatTableBlock.tsx");
const clipboard = read("lib/chatTableCopy.ts");
const parser = read("lib/chatMarkdown.ts");
const parentTests = read("components/terminal/ChatCodeBlock.test.ts");
const rendererTests = read("components/terminal/ChatTableBlock.test.ts");

test("WS-23 code uses PR #113 already existing code component and safe clipboard; never duplicate", () => {
  assert.match(markdown,/import ChatCodeBlock from "\.\/ChatCodeBlock"/);
  assert.match(markdown,/case "code":\s*return <ChatCodeBlock/);
  assert.match(code,/await copyChatCode\(writeText, code\)/);
  assert.match(code,/disabled=\{streaming\}/);
  assert.match(parentTests,/clipboard absence or rejection is failure/);
  assert.doesNotMatch(markdown,/dangerouslySetInnerHTML/);
});

test("WS-23 real table stays semantic, horizontally keyboard scrollable and announced", () => {
  assert.match(markdown,/import ChatTableBlock from "\.\/ChatTableBlock"/);
  assert.match(markdown,/case "table":\s*return \(\s*<ChatTableBlock/);
  assert.match(table,/role="region" tabIndex=\{0\} aria-label="Scrollable answer table"/);
  assert.match(table,/<caption className="sr-only">/);
  assert.match(table,/<th key=\{column\} scope="col"/);
  assert.match(table,/max-w-\[28rem\]/);
  assert.match(table,/data-chat-table-block="true"/);
});

test("WS-23 copied table is tab-separated but cannot become an untrusted formula", () => {
  assert.match(clipboard,/chatInlineText\(nodes\)/);
  assert.match(clipboard,/replace\(\/\[\\t\\r\\n\\u0000-\\u001f\\u007f\]\+\/g/);
  assert.match(clipboard,/\/\^\[=\+@\]\//);
  assert.match(clipboard,/return "'" \+ text/);
  assert.match(clipboard,/\.join\("\\t"\)\)\.join\("\\n"\)/);
  assert.doesNotMatch(clipboard,/text\/html|write\(\[new ClipboardItem/);
});

test("WS-23 a half-streamed table cannot claim successful copy", () => {
  assert.match(table,/disabled=\{streaming\}/);
  assert.match(table,/if \(streaming\) return/);
  assert.match(table,/setCopyState\(\(await copyChatTable\(writeText, table\)\) \? "copied" : "failed"\)/);
  assert.match(table,/role="alert"/);
  assert.match(table,/Table copied as tab-separated text/);
});

test("WS-23 two backticks protect pipes inside Markdown code table cells", () => {
  assert.match(parser,/let codeDelimiter = 0/);
  assert.match(parser,/if \(codeDelimiter === 0\) codeDelimiter = run/);
  assert.match(parser,/else if \(codeDelimiter === run\) codeDelimiter = 0/);
  assert.match(parser,/if \(ch === "\|" && codeDelimiter === 0\)/);
});

test("WS-23 links and arbitrary markup are still inert/validated before React rendering", () => {
  assert.match(parser,/export function safeHref\(/);
  assert.match(parser,/url\.username \|\| url\.password/);
  assert.match(parser,/javascript:|Unsafe destinations/);
  assert.match(parser,/Images are never fetched or rendered/);
  assert.match(markdown,/case "link": return <ExternalLink/);
  assert.doesNotMatch(markdown,/dangerouslySetInnerHTML|innerHTML|document\.write/);
});

test("WS-23 citations are offered only for exact saved/current observed sources", () => {
  assert.match(markdown,/const resolved = resolveCitation\(node, sources\)/);
  assert.match(markdown,/if \(!resolved\) return <React.Fragment key=\{index\}>\{node.raw\}/);
  assert.match(parser,/if \(matches\.length !== 1\) return null/);
  assert.match(parser,/if \(cite\.nums\.length\)/);
  assert.match(parser,/savedMessageCitationSources\(metadata: unknown\)/);
  assert.match(rendererTests,/unresolved citation stays literal/);
});

test("WS-23 no release/native acceptance without actual browser keyboard/screen reader results", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS23_READABLE_RESPONSES_TABLES_2026-10-23.md", import.meta.url), "utf8");
  for (const pr of ["#113", "#145", "#119"]) assert.ok(doc.includes(pr));
  assert.match(doc,/200% zoom[\s\S]{0,90}NOT_RUN/);
  assert.match(doc,/VoiceOver\/Narrator[\s\S]{0,90}NOT_RUN/);
});
