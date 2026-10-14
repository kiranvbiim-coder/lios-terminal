import test from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDERS } from "./byoaiRouter";
import { getProviderStatuses } from "./providerStatus";

test("provider status stays synchronized with the centralized BYOAI registry", async () => {
  const statuses = await getProviderStatuses();
  const aiStatuses = statuses.filter((status) => status.category === "ai");
  const expectedIds = AI_PROVIDERS.map((provider) => provider.id).sort();
  const actualIds = aiStatuses.map((status) => status.id).sort();

  assert.deepEqual(actualIds, expectedIds);
  assert.equal(new Set(actualIds).size, actualIds.length);
  assert.ok(actualIds.includes("lm_studio"));
  assert.ok(actualIds.includes("ollama"));
  assert.ok(actualIds.includes("openai_compatible"));
});
