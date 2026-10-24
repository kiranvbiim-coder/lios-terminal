import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResearchSourceList, { inspectableSourceHref } from "./ResearchSourceList";

test("source links require the same recorded HTTP identity and reject credentials or inferred homepages", () => {
  const sources = [
    { id: "provider:sec", label: "SEC", href: "https://sec.gov/" },
    { id: "https://user:secret@example.com/", label: "Credentialed", href: "https://user:secret@example.com/" },
    { id: "javascript:alert(1)", label: "Unsafe", href: "javascript:alert(1)" },
    { id: "https://example.com", label: "Recorded", href: "https://example.com/" },
  ];
  assert.deepEqual(sources.map(inspectableSourceHref), [null, null, null, "https://example.com/"]);
  const html = renderToStaticMarkup(createElement(ResearchSourceList, { sources }));
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /href="javascript|href="https:\/\/user/);
});
