import test from "node:test";
import assert from "node:assert/strict";
import { browseRegisteredSpecialists } from "./contextualSpecialistDiscovery";
import { isRegisteredView, isViewVisibleToAudience } from "./featureRegistry";
import { TERMINAL_CAPABILITIES } from "./terminalCatalog";

const views = (items: ReturnType<typeof browseRegisteredSpecialists>) => items.map(({ capability }) => capability.view);

test("explicit tool browsing includes non-hero registered specialists while the default catalog remains unchanged", () => {
  const browse = browseRegisteredSpecialists({ query: "", audience: "client" });
  const nonHero = browse.find(({ capability }) => !capability.hero);
  assert.ok(nonHero, "the Tools tab must expose specialist panels beyond hero tiles");
  assert.ok(browse.length > 18, "an empty Tools search should not be limited to the first 18 hero entries");
  assert.ok(browse.length <= TERMINAL_CAPABILITIES.length);
  assert.ok(browse.every(({ capability }) => isRegisteredView(capability.view) && isViewVisibleToAudience(capability.view, "client")));
  assert.equal(browse.some(({ capability }) => capability.view === "artifact"), false,
    "an exact P4 Artifact cannot be launched as an unowned blank tool");
});

test("internal, client and trial visibility is enforced before showing graph recommendations", () => {
  const client = browseRegisteredSpecialists({ query: "", audience: "client", activeView: "valuation" });
  assert.equal(client.some(({ capability }) => capability.view === "research"), false);
  assert.equal(client.some(({ capability }) => capability.view === "developer"), false);
  assert.equal(client.some(({ capability }) => capability.view === "advisory"), true);
  assert.equal(client.some(({ capability }) => capability.view === "spreadsheet"), false);

  const internal = browseRegisteredSpecialists({ query: "", audience: "internal", activeView: "valuation" });
  assert.equal(internal.some(({ capability }) => capability.view === "research"), true);
  assert.equal(internal.some(({ capability }) => capability.view === "advisory"), false);

  const trial = browseRegisteredSpecialists({ query: "", audience: "trial", activeView: "valuation" });
  assert.ok(trial.every(({ capability }) => isViewVisibleToAudience(capability.view, "trial")));
  assert.equal(trial.some(({ capability }) => capability.view === "advisory"), false);
});

test("current valuation surfaces only permitted graph-related follow-up tools before the catalog", () => {
  const results = browseRegisteredSpecialists({ query: "", audience: "client", activeView: "valuation", limit: 4 });
  assert.deepEqual(views(results).slice(0, 2), ["peercomp", "advancedrisk"]);
  assert.ok(results[0].relatedReason?.length);
  assert.ok(results[1].relatedReason?.length);
  assert.equal(results.some(({ capability }) => capability.view === "research"), false);
  assert.deepEqual(views(browseRegisteredSpecialists({ query: "", audience: "client", activeView: null, limit: 2 })).length, 2);
});

test("workspace filter and typed query expose specialist subcatalog without leaking other groups", () => {
  const byWorkspace = browseRegisteredSpecialists({ query: "", audience: "internal", workspace: "modeling" });
  assert.ok(byWorkspace.length > 8);
  assert.ok(byWorkspace.every(({ capability }) => capability.workspace === "modeling"));
  assert.ok(views(byWorkspace).includes("valuation"));

  const searched = browseRegisteredSpecialists({ query: "portfolio", audience: "client", workspace: "modeling" });
  assert.ok(searched.length > 0);
  assert.ok(searched.every(({ capability }) => capability.workspace === "modeling"));
  assert.ok(searched.every(({ capability }) => isViewVisibleToAudience(capability.view, "client")));
  assert.deepEqual(browseRegisteredSpecialists({ query: "nonexistent-super-tool", audience: "client" }), []);
});

test("result limits never bypass the original registry or introduce derived source authorization", () => {
  const all = browseRegisteredSpecialists({ query: "", audience: "client" });
  const limited = browseRegisteredSpecialists({ query: "", audience: "client", limit: 5 });
  assert.deepEqual(limited, all.slice(0, 5));
  assert.ok(limited.every((result) => !("entitlement" in result) && !("sourceGrant" in result)));
});

