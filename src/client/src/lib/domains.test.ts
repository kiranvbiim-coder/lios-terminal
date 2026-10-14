import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_FINANCE_DOMAIN, pickDefaultDomain } from "./domains";

test("Home Market defaults to finance without requiring a domain picker", () => {
  const picked = pickDefaultDomain([
    { id: 2, slug: "tourism_hospitality", name: "Tourism", icon: null, active: true },
    { id: 1, slug: "finance", name: "Finance", icon: null, active: true },
  ], null);
  assert.equal(picked?.slug, "finance");
  assert.equal(pickDefaultDomain([], null), null);
  assert.equal(FALLBACK_FINANCE_DOMAIN.slug, "finance");
});
