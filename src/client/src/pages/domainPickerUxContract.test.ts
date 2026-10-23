import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const domain = readFileSync(new URL("./DomainPicker.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("specialist picker is optional, provides a way back to Chat without a sign out", () => {
  assert.match(domain, /onCancel: \(\) => void/);
  assert.match(domain, /Back to Chat/);
  assert.match(domain, /onClick=\{onCancel\}/);
  assert.match(app, /onCancel=\{\(\) => setDomainPickerOpen\(false\)\}/);
  assert.match(app, /data-lios-workspace hidden=\{environmentSetupOpen \|\| domainPickerOpen\}/);
});

test("domain loading can be retried without breaking entitlement routing", () => {
  assert.match(domain, /const \[attempt, setAttempt\] = useState\(0\)/);
  assert.match(domain, /setAttempt\(\(value\) => value \+ 1\)/);
  assert.match(domain, /new AbortController/);
  assert.match(domain, /signal: controller.signal/);
  assert.match(domain, /controller.abort\(\)/);
  assert.match(domain, /\/api\/client\/dashboard\/domains/);
  assert.match(domain, /\/api\/admin\/domains/);
  assert.match(domain, /isClient, attempt/);
});

test("empty and error cases offer a recovery path, and disabled domains cannot be selected", () => {
  assert.match(domain, /domains.length === 0/);
  assert.match(domain, /No specialist workspaces available/);
  assert.match(domain, /Retry loading/);
  assert.match(domain, /role="alert"/);
  assert.match(domain, /disabled=\{!domain.active\}/);
  assert.match(domain, /if \(domain.active\) onChoose\(domain\)/);
  assert.match(domain, /aria-label=\{domain.active/);
});
