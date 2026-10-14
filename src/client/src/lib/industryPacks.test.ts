import { test } from "node:test";
import assert from "node:assert/strict";
import { INDUSTRY_PACKS, getIndustryPack, getPackOverride } from "./industryPacks";
import { getTemplate } from "./templateRegistry";

test("every industry pack has a unique id and at least one override", () => {
  const ids = INDUSTRY_PACKS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "pack ids should be unique");
  for (const pack of INDUSTRY_PACKS) assert.ok(pack.overrides.length > 0, `${pack.id} should override at least one template`);
});

test("every override targets a template that actually exists in the registry", () => {
  for (const pack of INDUSTRY_PACKS) {
    for (const override of pack.overrides) {
      assert.ok(getTemplate(override.templateId), `${pack.id} references unknown template "${override.templateId}"`);
    }
  }
});

test("getIndustryPack: finds a pack by id and returns undefined for an unknown one", () => {
  assert.equal(getIndustryPack("saas")?.label, "SaaS / Software");
  assert.equal(getIndustryPack("does-not-exist"), undefined);
});

test("getPackOverride: returns the override inputs for a template the pack touches, undefined otherwise", () => {
  const saas = getIndustryPack("saas");
  assert.deepEqual(getPackOverride(saas, "saas-metrics"), { grossMarginPct: 82, monthlyChurnPct: 1.5, cacPerCustomer: 2000 });
  assert.equal(getPackOverride(saas, "apv"), undefined);
  assert.equal(getPackOverride(undefined, "saas-metrics"), undefined);
});
