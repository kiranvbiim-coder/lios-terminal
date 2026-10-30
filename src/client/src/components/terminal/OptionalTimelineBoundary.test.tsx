import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OptionalTimelineBoundary } from "./OptionalTimelineBoundary";

test("optional timeline boundary preserves its normal child output", () => {
  const html = renderToStaticMarkup(createElement(OptionalTimelineBoundary, null,
    createElement("p", null, "Original timeline preview")));
  assert.match(html, /Original timeline preview/);
});

test("optional timeline failure is isolated and never exposes exception details", () => {
  const boundary = new OptionalTimelineBoundary({ children: createElement("div", null, "hidden visual") });
  boundary.state = OptionalTimelineBoundary.getDerivedStateFromError();
  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /role="alert"/);
  assert.match(html, /Original recorded items and source history remain available/);
  assert.doesNotMatch(html, /hidden visual|Error:|stack trace/);
});

