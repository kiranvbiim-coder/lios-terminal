import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_DOMAINS } from "./platformBootstrap";

test("platform bootstrap includes active finance workspace", () => {
  const finance = PLATFORM_DOMAINS.find((domain) => domain.slug === "finance");
  assert.equal(finance?.name, "Finance");
  assert.equal(finance?.active, true);
});

test("platform bootstrap keeps workspace slugs unique", () => {
  const slugs = PLATFORM_DOMAINS.map((domain) => domain.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});
