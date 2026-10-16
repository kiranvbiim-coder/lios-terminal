import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProvenanceBadge, { ProvenanceDisclosure } from "./ProvenanceBadge";

test("SI-07.20 provenance dialog trigger announces modal intent and collapsed state", () => {
  const markup = renderToStaticMarkup(createElement(ProvenanceBadge, {
    details: { kind: "source", source: "Internal reference", limitations: "Evidence not verified" },
    retailVisible: true,
  }));
  assert.match(markup, /aria-haspopup="dialog"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-controls="[^"]+"/);
  assert.doesNotMatch(markup, /role="dialog"/, "Closed dialog must not appear in accessible DOM");
});

test("SI-07.20 compact disclosure labels its toggle without exposing hidden detail", () => {
  const markup = renderToStaticMarkup(createElement(ProvenanceDisclosure, {
    details: { kind: "model", source: "Sensitive evidence preview", limitations: "Unverified" },
    label: "MODEL LINEAGE",
  }));
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-controls="[^"]+"/);
  assert.doesNotMatch(markup, /Sensitive evidence preview/);
  assert.doesNotMatch(markup, /role="region"/);
});
