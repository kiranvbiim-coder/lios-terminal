import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMarkdown from "./ChatMarkdown";
import { collectCitationSources, parseChatMarkdown, resolveCitation, savedMessageCitationSources, safeHref, stripMachineDirectives, type ChatCitationSource } from "@/lib/chatMarkdown";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

function render(text: string, options: { streaming?: boolean; sources?: ChatCitationSource[] } = {}): string {
  return renderToStaticMarkup(createElement(ChatMarkdown, { text, streaming: options.streaming, sources: options.sources }));
}

const TABLE = ["| Metric | FY23 | FY24 |", "| :--- | ---: | ---: |", "| Revenue | 1,200 | 1,450 |", "| Margin | 21.5% | 23.1% |"].join("\n");

test("a Markdown table renders as a real, accessible <table>", () => {
  const markup = render(`Here is the summary.\n\n${TABLE}\n\nDone.`);
  assert.match(markup, /<table\b/);
  assert.match(markup, /<thead\b/);
  assert.equal((markup.match(/<th scope="col"/g) ?? []).length, 3);
  assert.equal((markup.match(/<tr\b/g) ?? []).length, 3, "one header row and two body rows");
  assert.match(markup, />Revenue<\/td>/);
  assert.match(markup, /text-right[^>]*>1,450</, "right alignment from the delimiter row is applied");
  assert.match(markup, /role="region"[^>]*tabindex="0"/, "wide tables scroll from the keyboard");
  assert.doesNotMatch(markup, /\|\s*:?---/, "the delimiter row is never shown as text");
});

test("headings, emphasis, inline and fenced code, lists and quotes become semantic elements", () => {
  const markup = render([
    "# Title",
    "",
    "## Section",
    "",
    "A **bold** and *italic* and `code` and ~~gone~~ line.",
    "",
    "1. First",
    "2. Second",
    "   - nested point",
    "",
    "- bullet one",
    "- bullet two",
    "",
    "> quoted",
    "",
    "```python",
    "x = 1 < 2",
    "```",
  ].join("\n"));
  assert.match(markup, /<h1\b[^>]*>Title<\/h1>/);
  assert.match(markup, /<h2\b[^>]*>Section<\/h2>/);
  assert.match(markup, /<strong[^>]*>bold<\/strong>/);
  assert.match(markup, /<em>italic<\/em>/);
  assert.match(markup, /<code[^>]*>code<\/code>/);
  assert.match(markup, /<del>gone<\/del>/);
  assert.match(markup, /<ol\b[^>]*>[\s\S]*First[\s\S]*Second[\s\S]*<ul\b[^>]*>[\s\S]*nested point/);
  assert.match(markup, /<ul\b[^>]*>[\s\S]*bullet one[\s\S]*bullet two/);
  assert.match(markup, /<blockquote\b[^>]*>[\s\S]*quoted/);
  assert.match(markup, /<pre\b[^>]*><code data-language="python">x = 1 &lt; 2<\/code><\/pre>/);
});

test("unsafe links, images and HTML are inert", () => {
  const markup = render([
    "[click](javascript:alert(1)) and [data](data:text/html;base64,AAAA) and [rel](/local/path) and [creds](https://user:pw@example.com/).",
    "",
    "<script>alert(1)</script> <img src=x onerror=alert(1)> ![pixel](https://tracker.example/p.png)",
    "",
    "<a href=\"javascript:alert(1)\">raw html link</a>",
  ].join("\n"));
  assert.doesNotMatch(markup, /<a\b/);
  assert.doesNotMatch(markup, /<script|<img|<iframe/i);
  assert.doesNotMatch(markup, /href="javascript/i);
  assert.match(markup, /click/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /pixel/, "image alt text stays as plain text");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("JaVaScRiPt:alert(1)"), null);
  assert.equal(safeHref("data:text/html,x"), null);
  assert.equal(safeHref("vbscript:x"), null);
  assert.equal(safeHref("https://example.com/a b"), null);
  assert.equal(safeHref("https://user:pw@example.com/"), null);
});

test("safe links open without opener access, and bare URLs are linkified without trailing punctuation", () => {
  const markup = render("See [the filing](https://www.sec.gov/ix?doc=1), https://example.com/report. Write to [us](mailto:team@example.com).");
  assert.match(markup, /<a href="https:\/\/www\.sec\.gov\/ix\?doc=1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>the filing<\/a>/);
  assert.match(markup, /<a href="https:\/\/example\.com\/report"[^>]*>https:\/\/example\.com\/report<\/a>\./);
  assert.match(markup, /<a href="mailto:team@example\.com"[^>]*rel="noopener noreferrer"/);
});

test("machine directives never reach the screen, including a half-streamed one", () => {
  assert.doesNotMatch(render("Opening it now. <<NAVIGATE:chart>> Done."), /NAVIGATE|&lt;&lt;/);
  assert.doesNotMatch(render("Layout <<WORKSPACE_LAYOUT:research>> set, <<WORKSPACE_OPEN:valuation, AAPL>> opened."), /WORKSPACE|&lt;&lt;/);
  assert.doesNotMatch(render("Unknown <<FUTURE_ACTION:x>> directive."), /FUTURE_ACTION/);
  for (const partial of ["Done <<", "Done <<NAV", "Done <<NAVIGATE:cha", "Done <<NAVIGATE:chart>"]) {
    const markup = render(partial, { streaming: true });
    assert.doesNotMatch(markup, /NAV|&lt;&lt;|&lt;/, `half-streamed directive must stay hidden: ${partial}`);
    assert.match(markup, /Done/);
  }
  assert.equal(stripMachineDirectives("a << b", true), "a << b", "ordinary shift/compare text is not a directive");
});

test("every streaming prefix of a rich answer renders without throwing, and partial markup degrades gracefully", () => {
  const full = [`# Report`, "", "Revenue is **up 12%** per [1] and `EPS`.", "", TABLE, "", "- a", "- b", "", "```ts", "const x = 1;", "```", "", "See [source: SEC EDGAR] and [link](https://example.com/x)."].join("\n");
  for (let end = 0; end <= full.length; end++) {
    assert.doesNotThrow(() => render(full.slice(0, end), { streaming: true }), `prefix length ${end}`);
    assert.doesNotThrow(() => render(full.slice(0, end), { streaming: false }), `prefix length ${end}`);
  }
  assert.match(render("```ts\nconst a = 1;", { streaming: true }), /<pre[^>]*><code[^>]*>const a = 1;<\/code><\/pre>/, "an open fence renders as code immediately");
  assert.match(render("Revenue is **up 1", { streaming: true }), /<strong[^>]*>up 1<\/strong>/, "unclosed bold formats instead of showing ** markers");
  assert.doesNotMatch(render("Revenue is **up 1", { streaming: true }), /\*\*/);
  assert.match(render("Revenue is **up 1", { streaming: false }), /\*\*up 1/, "a finished message with a stray marker keeps it literal");
  assert.doesNotMatch(render("Read [the fil", { streaming: true }).replace(/<[^>]*>/g, ""), /\[/, "a link label still arriving does not flash a bracket");
  assert.doesNotMatch(render("Read [the filing](https://exam", { streaming: true }), /\]\(|https/, "a link destination still arriving is hidden");
  assert.match(render("| a | b |\n|---|", { streaming: true }), /<table\b/, "a partially received delimiter row already yields the table");
  assert.doesNotMatch(render("| a | b |\n|---|---|\n| 1 | 2", { streaming: true }), /\|---/);
});

test("adversarial and random markup never throws and never produces executable markup", () => {
  let seed = 7;
  const next = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const alphabet = ["*", "_", "`", "~", "[", "]", "(", ")", "<", ">", "|", "-", ":", "\\", "\n", " ", "#", "!", "1.", "http://", "javascript:", "<<", "a", "**", "> ", "- ", "```"];
  for (let round = 0; round < 400; round++) {
    let text = "";
    for (let i = 0; i < 60; i++) text += alphabet[Math.floor(next() * alphabet.length)];
    for (const streaming of [false, true]) {
      let markup = "";
      assert.doesNotThrow(() => { markup = render(text, { streaming }); }, JSON.stringify(text));
      assert.doesNotMatch(markup, /<script|<img|<iframe|\son[a-z]+=|href="javascript/i, JSON.stringify(text));
    }
  }
  assert.doesNotThrow(() => parseChatMarkdown("> ".repeat(200) + "deep\n" + "- ".repeat(200) + "x"));
  assert.doesNotThrow(() => parseChatMarkdown("*".repeat(5000)));
});

test("citation markers become keyboard-accessible affordances only when they match a real source exactly", () => {
  const sources: ChatCitationSource[] = [
    { id: "provider:sec_edgar", label: "SEC EDGAR", index: 1 },
    { id: "https://www.federalreserve.gov/releases/h15", label: "Federal Reserve H.15", href: "https://www.federalreserve.gov/releases/h15", index: 2 },
  ];
  const markup = render("Revenue grew [1] and rates fell [2], but [3] is unknown; also [source: SEC EDGAR] and [source: Not A Real Source].", { sources });
  assert.match(markup, /<button type="button"[^>]*aria-label="Source 1: SEC EDGAR"[^>]*aria-expanded="false"[^>]*data-citation="1"[^>]*>\[1\]<\/button>/);
  assert.match(markup, /<a href="https:\/\/www\.federalreserve\.gov\/releases\/h15"[^>]*aria-label="Source 2: Federal Reserve H\.15"[^>]*>\[2\]<\/a>/);
  assert.match(markup, /but \[3\] is unknown/, "an unmatched number stays plain text");
  assert.match(markup, /\[source: Not A Real Source\]/, "an unmatched named source stays plain text");
  assert.equal((markup.match(/data-citation="1"/g) ?? []).length, 2, "[1] and [source: SEC EDGAR] resolve to the same real source");

  const without = render("Revenue grew [1] and [source: SEC EDGAR].");
  assert.doesNotMatch(without, /<button|<a\b|data-citation/);
  assert.match(without, /\[1\]/);
  assert.match(render("Pair [1, 3] stays text", { sources }), /\[1, 3\]/, "a group is all-or-nothing");
});

test("a numeric citation never resolves by position: it needs an index the runtime assigned", () => {
  const unnumbered: ChatCitationSource[] = [{ id: "provider:sec_edgar", label: "SEC EDGAR" }, { id: "provider:fred", label: "FRED" }];
  const markup = render("Revenue grew [1] and rates fell [2].", { sources: unnumbered });
  assert.doesNotMatch(markup, /<button|<a\b|data-citation/);
  assert.match(markup, /\[1\].*\[2\]/);
  const numbered = render("Rates fell [7].", { sources: [{ id: "provider:fred", label: "FRED", index: 7 }] });
  assert.match(numbered, /data-citation="7"/);
});

test("named citations match only exactly (normalized), never by substring", () => {
  const sources: ChatCitationSource[] = [{ id: "provider:sec_edgar", label: "SEC EDGAR" }, { id: "provider:fred", label: "Federal Reserve Economic Data" }];
  const exact = render("A [source: sec-edgar] and [source: provider:fred].", { sources });
  assert.equal((exact.match(/data-citation=/g) ?? []).length, 2);
  for (const near of ["[source: SEC]", "[source: EDGAR filings]", "[source: Federal Reserve]", "[source: Economic Data Extra]"]) {
    assert.doesNotMatch(render(`See ${near}.`, { sources }), /data-citation/, near);
  }
});

test("streaming leniency applies only to the final block; finished blocks stay literal", () => {
  const markup = render("First **stray marker and [half\n\nSecond block with **bold so far", { streaming: true });
  assert.match(markup, /First \*\*stray marker and \[half/, "an earlier finished paragraph keeps its stray markers literally");
  assert.match(markup, /<strong[^>]*>bold so far<\/strong>/, "the final block is still lenient");
  const blocks = parseChatMarkdown("- one **a\n- two **b", { streaming: true });
  const items = (blocks[0] as Extract<(typeof blocks)[number], { t: "list" }>).items;
  assert.equal(JSON.stringify(items[0]).includes("strong"), false, "only the last list item is lenient");
  assert.equal(JSON.stringify(items[1]).includes("strong"), true);
});

test("directive stripping never alters fenced code and keeps blank lines inside it", () => {
  const text = "Before <<NAVIGATE:chart>>\n\n```text\n<<NAVIGATE:chart>>\n\n\n\nline\n```\n\nAfter <<WORKSPACE_LAYOUT:research>> end";
  const stripped = stripMachineDirectives(text);
  assert.match(stripped, /```text\n<<NAVIGATE:chart>>\n\n\n\nline\n```/);
  assert.doesNotMatch(stripped.replace(/```text[\s\S]*?```/, ""), /<<|NAVIGATE|WORKSPACE/);
  const code = parseChatMarkdown(text).find((block) => block.t === "code");
  assert.equal(code?.t === "code" ? code.v : null, "<<NAVIGATE:chart>>\n\n\n\nline");
  assert.equal(stripMachineDirectives("```\nhalf <<NAV", true), "```\nhalf <<NAV", "a partial directive inside an open fence is code, not stripped");
});

test("pathological unclosed markers stay fast", () => {
  const started = Date.now();
  for (const text of ["*".repeat(20_000), "[".repeat(20_000), "_a ".repeat(7_000), "**a ".repeat(5_000)]) {
    assert.doesNotThrow(() => parseChatMarkdown(text));
    assert.doesNotThrow(() => parseChatMarkdown(text, { streaming: true }));
  }
  assert.ok(Date.now() - started < 8_000, "no quadratic blow-up");
});

test("citation sources come only from the run's real source references", () => {
  const at = new Date().toISOString();
  const requestId = "11111111-1111-4111-8111-111111111111";
  const events = [
    { type: "tool_result", requestId, at, stepId: "s1", label: "Filings", summary: "ok", deterministic: true, sourceRefs: ["provider:sec_edgar@2026-10-01", "engine:dcf", "https://example.com/doc"] },
    { type: "tool_result", requestId, at, stepId: "s2", label: "Filings again", summary: "ok", deterministic: true, sourceRefs: ["provider:sec_edgar"] },
  ] as unknown as ConversationRuntimeEvent[];
  const sources = collectCitationSources(events);
  assert.deepEqual(sources.map((source) => source.id), ["provider:sec_edgar@2026-10-01", "https://example.com/doc", "provider:sec_edgar"]);
  assert.equal(sources.some((source) => source.id.startsWith("engine:")), false, "internal engine refs are not user-facing sources");
  assert.equal(sources.find((source) => source.id === "https://example.com/doc")?.href, "https://example.com/doc");
  assert.equal(sources[0].href ?? null, null);
});

test("duplicate provider labels never select an arbitrary document; exact retained IDs remain resolvable", () => {
  const sources = savedMessageCitationSources({ citationSources: [
    { id: "https://example.test/filing/first", label: "SEC" },
    { id: "https://example.test/filing/second", label: "SEC" },
  ] });
  assert.equal(sources.length, 2);
  assert.equal(resolveCitation({ t: "cite", raw: "[source: SEC]", nums: [], name: "SEC" }, sources), null);
  const resolved = resolveCitation({ t: "cite", raw: "", nums: [], name: "https://example.test/filing/second" }, sources);
  assert.equal(resolved?.[0].source.id, "https://example.test/filing/second");
});

test("saved answer citation sources never depend on another run", () => {
  const previous = { citationSources: [{ id: "https://example.test/old", label: "SEC" }] };
  const current = { citationSources: [{ id: "https://example.test/new", label: "SEC" }] };
  assert.equal(savedMessageCitationSources(previous)[0].href, "https://example.test/old");
  assert.equal(savedMessageCitationSources(current)[0].href, "https://example.test/new");
  assert.equal(savedMessageCitationSources(previous)[0].href, "https://example.test/old");
  assert.deepEqual(savedMessageCitationSources({}), []);
});
