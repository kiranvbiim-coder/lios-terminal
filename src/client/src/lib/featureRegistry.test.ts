import assert from "node:assert/strict";
import test from "node:test";
import {
  getVisibleViewsForWorkspace,
  getVisibleWorkspaces,
  getWorkspaceForView,
  isViewVisibleToAudience,
  PRIMARY_WORKSPACES,
} from "./featureRegistry";

test("primary navigation exposes the contracted destinations once and in order", () => {
  const navigation = getVisibleWorkspaces("internal");

  assert.deepEqual(
    navigation.map(({ key, label }) => [key, label]),
    [
      ["home", "Home"],
      ["data", "Data"],
      ["finance", "Finance"],
      ["modeling", "Modeling"],
      ["research", "Research"],
      ["intelligence", "Intelligence"],
      ["outputs", "Outputs"],
      ["advanced", "Advanced"],
      ["settings", "Settings"],
    ],
  );
  assert.equal(new Set(navigation.map((workspace) => workspace.entryView)).size, navigation.length);
});

test("client and trial navigation retain the same primary destinations without internal utilities", () => {
  for (const audience of ["client", "trial"] as const) {
    const navigation = getVisibleWorkspaces(audience);
    const visibleViews = navigation.flatMap((workspace) => workspace.views);
    assert.deepEqual(
      navigation.map((workspace) => workspace.key),
      ["home", "data", "finance", "modeling", "research", "intelligence", "outputs", "advanced", "settings"],
    );
    assert.equal(visibleViews.includes("developer"), false);
    assert.equal(visibleViews.includes("adminconsole"), false);
    assert.equal(visibleViews.includes("uide"), false);
  }
});

test("Pro-style trial keeps core monitoring workflows available", () => {
  for (const view of ["watchlist", "alerts"] as const) {
    assert.equal(isViewVisibleToAudience(view, "client"), true);
    assert.equal(isViewVisibleToAudience(view, "trial"), true);
  }
});

test("client-only specialist features route only to full client builds", () => {
  for (const view of ["decisionmemory", "advisory", "activity", "crossdomainfusion", "clientdata"] as const) {
    assert.equal(isViewVisibleToAudience(view, "internal"), false);
    assert.equal(isViewVisibleToAudience(view, "client"), true);
    assert.equal(isViewVisibleToAudience(view, "trial"), false);
  }
  assert.equal(isViewVisibleToAudience("workspaces", "client"), false);
  assert.equal(isViewVisibleToAudience("workspaces", "trial"), false);
});

test("representative specialist features remain reachable under the correct parent", () => {
  assert.equal(getWorkspaceForView("missioncontrol"), "home");
  assert.equal(getWorkspaceForView("connectors"), "data");
  assert.equal(getWorkspaceForView("market"), "finance");
  for (const financeView of [
    "heatmap",
    "marketbreadth",
    "sectorrotation",
    "shortinterest",
    "regime",
  ] as const) {
    assert.equal(getWorkspaceForView(financeView), "finance");
  }
  assert.equal(getWorkspaceForView("valuation"), "modeling");
  assert.equal(getWorkspaceForView("research"), "research");
  assert.equal(getWorkspaceForView("decisionengine"), "intelligence");
  assert.equal(getWorkspaceForView("spreadsheet"), "outputs");
  assert.equal(getWorkspaceForView("developer"), "advanced");
  assert.equal(getWorkspaceForView("environment"), "settings");
  for (const modelView of [
    "fixedincome",
    "optimizer",
    "risknetwork",
    "fractal",
    "ising",
    "quantum",
    "hawkes",
    "entropy",
    "backtesting",
  ] as const) {
    assert.equal(getWorkspaceForView(modelView), "modeling");
  }
  assert.equal(getWorkspaceForView("cotpositioning"), "research");
});

test("options pricing remains visible from the modeling workspace", () => {
  assert.equal(getWorkspaceForView("options"), "modeling");
  for (const audience of ["internal", "client", "trial"] as const) {
    assert.equal(isViewVisibleToAudience("options", audience), true);
    assert.equal(getVisibleViewsForWorkspace("modeling", audience).includes("options"), true);
  }
});

test("a feature has one canonical primary-navigation placement", () => {
  const seen = new Set<string>();
  for (const workspace of PRIMARY_WORKSPACES) {
    for (const view of workspace.views) {
      assert.equal(seen.has(view), false, `${view} is assigned to multiple primary destinations`);
      seen.add(view);
    }
  }
});

test("every primary destination opens one of its audience-visible features", () => {
  for (const audience of ["internal", "client", "trial"] as const) {
    for (const workspace of getVisibleWorkspaces(audience)) {
      assert.equal(
        getVisibleViewsForWorkspace(workspace.key, audience).includes(workspace.entryView),
        true,
        `${audience} ${workspace.key} entry must be visible`,
      );
    }
  }
});