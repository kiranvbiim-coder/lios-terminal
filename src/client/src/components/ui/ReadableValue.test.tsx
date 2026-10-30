import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadableValue, TechnicalDetails } from "./ReadableValue";

const render = (props: Parameters<typeof ReadableValue>[0]) => renderToStaticMarkup(createElement(ReadableValue, props));
const RAW_JSON = /\{&quot;|\[\{|\{"|&quot;[A-Za-z]+&quot;\s*:/;

test("uniform arrays of records render as a sortable table with humanized headers", () => {
  const markup = render({ value: [{ ticker: "AAA", market_cap: 1, isActive: true }, { ticker: "BBB", market_cap: 2, isActive: false }] });
  assert.match(markup, /<table/);
  for (const header of ["Ticker", "Market cap", "Is active"]) assert.match(markup, new RegExp(`<th[^>]*><button[^>]*>${header}</button></th>`));
  assert.equal((markup.match(/<tr/g) ?? []).length, 3);
  assert.match(markup, />Yes</);
  assert.match(markup, />No</);
  assert.doesNotMatch(markup, RAW_JSON);
});

test("long tables are capped with Show all; exact mode keeps every row", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, value: i * 2 }));
  const capped = render({ value: rows, rowLimit: 10 });
  assert.equal((capped.match(/<tbody>.*<\/tbody>/)?.[0].match(/<tr/g) ?? []).length, 10);
  assert.match(capped, /Show all 30 \(showing 10\)/);
  const exact = render({ value: rows, rowLimit: 10, exact: true });
  assert.equal((exact.match(/<tbody>.*<\/tbody>/)?.[0].match(/<tr/g) ?? []).length, 30);
  assert.doesNotMatch(exact, /Show all/);
});

test("objects become labelled rows with null as a dash and booleans as Yes/No", () => {
  const markup = render({ value: { netDebt: null, allowShorts: false, snake_case_key: "text", discountRatePct: 9.5 } });
  for (const label of ["Net debt", "Allow shorts", "Snake case key", "Discount rate"]) assert.ok(markup.includes(`>${label}<`), `missing ${label}`);
  assert.match(markup, />—</);
  assert.match(markup, />No</);
  assert.match(markup, />9\.5%</);
  for (const raw of ["netDebt", "allowShorts", "snake_case_key", "null", "false"]) assert.ok(!markup.includes(`>${raw}<`), `raw ${raw} leaked`);
});

test("ISO dates read locally while the stored value stays inspectable", () => {
  const markup = render({ value: { retrievedAt: "2026-10-30T13:17:06Z", effectiveDate: "2026-10-30" } });
  assert.match(markup, /title="2026-10-30T13:17:06Z"/);
  assert.match(markup, /title="2026-10-30"/);
  assert.doesNotMatch(markup, />2026-10-30T13:17:06Z</);
});

test("nested records are collapsible sections; deeper levels start closed and keep their data", () => {
  const markup = render({ value: { outer: { inner: { rate: 0.0937 } }, tags: ["a", "b"] } });
  assert.match(markup, /<details open=""[^>]*><summary[^>]*><span[^>]*>Outer<\/span>/);
  assert.match(markup, /<details class="[^"]*"><summary[^>]*><span[^>]*>Inner<\/span>/);
  assert.match(markup, /0\.0937/);
  assert.match(markup, /<li[^>]*><span[^>]*>a<\/span><\/li>/);
  const closed = render({ value: { outer: { inner: 1 } }, openDepth: 0 });
  assert.doesNotMatch(closed, /<details open/);
});

test("exact mode shows stored digits and strings verbatim; Technical details starts closed", () => {
  const exact = render({ value: { valuePerShare: 71.370824940136, state: "needs-review" }, exact: true });
  assert.match(exact, />71\.370824940136 per share</);
  assert.match(exact, />needs-review</);
  const details = renderToStaticMarkup(createElement(TechnicalDetails, { value: { a: 1 } }));
  assert.match(details, /^<details class/);
  assert.match(details, />Technical details</);
});
