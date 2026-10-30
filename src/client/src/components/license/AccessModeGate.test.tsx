import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LicenseAccess } from "@/lib/licenseAccess";
import { FirstRunLicenseChoice, ReadOnlyBanner } from "./AccessModeGate";

const readOnly: LicenseAccess = { mode: "read_only", reason: "trial_expired", trialEndsAt: null, licenseExpiresAt: null, daysLeft: null, canStartTrial: false, isOwner: true };
const page = (child: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, child));

test("the read-only banner tells the owner what happened and offers the key entry", () => {
  const html = page(createElement(ReadOnlyBanner, { access: readOnly }));
  assert.match(html, /data-testid="read-only-banner"/);
  assert.match(html, /role="status"/);
  assert.match(html, /trial has ended/);
  assert.match(html, /open and export your work/);
  assert.match(html, />Enter license key</);
});

test("a non-owner is told to ask the owner rather than offered a key box", () => {
  const html = page(createElement(ReadOnlyBanner, { access: { ...readOnly, isOwner: false } }));
  assert.match(html, /Ask the owner of this installation/);
  assert.doesNotMatch(html, />Enter license key</);
});

test("no banner appears while new work is allowed", () => {
  assert.equal(page(createElement(ReadOnlyBanner, { access: { ...readOnly, mode: "full", reason: "trial_active" } })), "");
});

test("first run offers Start 7-day trial and Enter license key, with labelled controls", () => {
  const html = page(createElement(FirstRunLicenseChoice));
  assert.match(html, /data-testid="first-run-license-choice"/);
  assert.match(html, /aria-labelledby="first-run-license-title"/);
  assert.match(html, />Start 7-day trial</);
  assert.match(html, />Enter license key</);
});
