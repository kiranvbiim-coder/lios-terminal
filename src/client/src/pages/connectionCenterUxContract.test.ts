import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./DataConnectionCenter.tsx", import.meta.url), "utf8");

// Source-level guards only. Browser focus/keyboard, screen reader, narrow
// viewport and packaged Desktop must be tested separately on exact PR head.
test("connection provider forms use the existing accessible modal primitives", () => {
  assert.match(source, /import \{ Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle \} from "@\/components\/ui\/dialog"/);
  assert.match(source, /<Dialog open onOpenChange=\{\(isOpen\) => \{ if \(!isOpen\) onClose\(\); \}\}>/);
  assert.match(source, /<DialogContent className="max-h-\[min\(90dvh,760px\)\]/);
  assert.match(source, /<DialogTitle/);
  assert.match(source, /<DialogDescription/);
  assert.doesNotMatch(source, /onClick=\{onClose\}>\s*<div className="bg-\[#0a0a0a\]/);
  assert.ok((source.match(/<ModalShell title=/g) ?? []).length >= 5);
});

test("connections and AI setup have labelled controls and readable first-use actions", () => {
  assert.match(source, /<label htmlFor="ai-provider-select"/);
  assert.match(source, /<select id="ai-provider-select"/);
  assert.match(source, /<label htmlFor="ai-model-select"/);
  assert.match(source, /id="ai-model-select"/);
  assert.match(source, /const inputCls = "min-h-11/);
  assert.match(source, /focus-visible:outline-primary/);
  assert.match(source, /data-first-use-connections="optional"/);
  assert.match(source, /data-testid="connection-primary-actions"/);
  assert.match(source, /data-testid="connect-ai"/);
  assert.match(source, /data-testid="connect-data"/);
});

test("credential UI retains password masking and truthfully reports connection outcomes", () => {
  assert.match(source, /<input type="password" value=\{key\}/);
  assert.match(source, /role=\{ok \? "status" : "alert"\}/);
  assert.match(source, /No AI provider connected/);
  assert.match(source, /No data source connected yet/);
  assert.match(source, /onClick=\{handleEnterTerminal\}/);
});
