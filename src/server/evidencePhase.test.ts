import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopAcceptanceSnapshot } from "./desktopAcceptance";
import { buildProviderAcceptanceSnapshot } from "./providerAcceptance";

test("live provider evidence stays unverified without dated runtime proof", async () => {
  const snapshot = await buildProviderAcceptanceSnapshot(new Date("2026-09-20T00:00:00.000Z"), {});
  const smtp = snapshot.rows.find((row) => row.id === "communications:smtp");
  assert.equal(smtp?.liveVerified, false);
  assert.ok(snapshot.rows.some((row) => row.category === "ai" && row.liveVerified === false));
  assert.ok(snapshot.externalBlockers.length > 0);
});

test("signed desktop evidence remains blocked until release-runner timestamps exist", () => {
  const desktop = buildDesktopAcceptanceSnapshot(new Date("2026-09-20T00:00:00.000Z"), {});
  assert.equal(desktop.rows.find((row) => row.id === "desktop:macos-signed-notarized")?.state, "blocked");
  assert.equal(desktop.rows.find((row) => row.id === "desktop:windows-authenticode")?.state, "blocked");
  assert.equal(desktop.rows.find((row) => row.id === "desktop:macos-update-rollback")?.state, "blocked");
});
