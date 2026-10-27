import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatTerminalControl } from "./ChatTerminalSurface";

test("Chat's universal tool launcher is an in-composer affordance, not a finance-only tab", () => {
  const markup = renderToStaticMarkup(createElement(ChatTerminalControl, {
    audience: "client",
    selected: { view: "chart", symbol: "AAPL" },
    onSelect: () => undefined,
  }));
  assert.match(markup, /data-testid="chat-contextual-tools-trigger"/);
  assert.match(markup, /Browse research and analysis tools/);
  assert.match(markup, />Tools</);
  assert.doesNotMatch(markup, /Finance terminal|Existing finance terminal tools/i);
  assert.doesNotMatch(markup, /apiKey|sourceScope|grantPermission/);
});
