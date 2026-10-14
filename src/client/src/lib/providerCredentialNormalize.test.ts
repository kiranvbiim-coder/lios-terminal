import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderApiCredential } from "@shared/providerCredentialNormalize";

test("normalize strips leading error-banner symbol from pasted keys", () => {
  const { value, rejection } = normalizeProviderApiCredential("\u2717 sk-live-abc");
  assert.equal(rejection, null);
  assert.equal(value, "sk-live-abc");
});

test("normalize rejects non-ASCII characters with a clear message", () => {
  const { rejection } = normalizeProviderApiCredential("\u{1F600}key");
  assert.match(rejection ?? "", /non-ASCII/i);
});
