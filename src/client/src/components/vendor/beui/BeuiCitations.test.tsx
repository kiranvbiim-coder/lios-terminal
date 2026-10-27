import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BeuiCitations } from "./BeuiCitations";
import type { TrustCitationItem } from "@/lib/trustCitationPresentation";

const citation = (index: number, href: string | null = null): TrustCitationItem => ({
  id: "evidence-" + index,
  title: "Evidence source " + index,
  sourceRef: href ?? "project:internal-" + index,
  href,
  details: ["feed", "high quality", "As-of unavailable"],
});

test("beUI citation adaptation renders recorded identity and no invented external link", () => {
  const rendered = renderToStaticMarkup(createElement(BeuiCitations, { items: [
    citation(1, "https://publisher.example/story"), citation(2),
  ] }));
  assert.match(rendered, /data-testid="p3-beui-evidence-citations"/);
  assert.match(rendered, /href="https:\/\/publisher\.example\/story"/);
  assert.match(rendered, /rel="noreferrer noopener"/);
  assert.match(rendered, /project:internal-2/);
  assert.doesNotMatch(rendered, /href="project:/);
  assert.doesNotMatch(rendered, /<img|favicon\.ico/);
});

test("beUI citations remain bounded by default with explicit disclosure and full count", () => {
  const rendered = renderToStaticMarkup(createElement(BeuiCitations, {
    items: Array.from({ length: 13 }, (_, i) => citation(i + 1)),
  }));
  assert.match(rendered, /Show all 13 recorded sources/);
  assert.match(rendered, /aria-expanded="false"/);
  assert.match(rendered, /Evidence source 8/);
  assert.doesNotMatch(rendered, /Evidence source 9/);
});

test("empty evidence stays honest instead of rendering demo sources", () => {
  const rendered = renderToStaticMarkup(createElement(BeuiCitations, { items: [] }));
  assert.match(rendered, /No external\/source observation supports this output/);
  assert.doesNotMatch(rendered, /href=/);
});
