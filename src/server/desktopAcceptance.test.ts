import test from "node:test";
import assert from "node:assert/strict";
import { buildDesktopAcceptanceSnapshot } from "./desktopAcceptance";

test("P2 desktop acceptance accounts for every platform qualification row", () => {
  const snapshot = buildDesktopAcceptanceSnapshot(new Date("2026-09-19T13:00:00.000Z"), {});
  assert.equal(snapshot.contractVersion, "1.0.0");
  assert.equal(snapshot.generatedAt, "2026-09-19T13:00:00.000Z");
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.rows.length, 12);
  for (const id of [
    "desktop:native-secret-custody",
    "desktop:bundled-python-sidecar",
    "desktop:workspace-recovery-contract",
    "desktop:signed-release-workflows",
    "desktop:macos-signed-notarized",
    "desktop:windows-authenticode",
    "desktop:macos-clean-install",
    "desktop:windows-clean-install",
    "desktop:macos-update-rollback",
    "desktop:windows-update-rollback",
    "desktop:macos-accessibility",
    "desktop:windows-accessibility",
  ]) {
    assert.ok(snapshot.rows.some((row) => row.id === id), `missing ${id}`);
  }
  for (const row of snapshot.rows) {
    if (row.state === "verified") assert.equal(row.blockers.length, 0);
    else assert.ok(row.blockers.length > 0, `${row.id} needs an explicit blocker`);
    assert.ok(row.nextAction.trim());
  }
});

test("P2 desktop acceptance only promotes native custody in a packaged protected runtime", () => {
  const snapshot = buildDesktopAcceptanceSnapshot(new Date("2026-09-19T13:05:00.000Z"), {
    LIOS_DESKTOP_PACKAGED: "true",
    LIOS_NATIVE_SECRET_CUSTODY: "native_protected",
    LIOS_NATIVE_SECRET_CUSTODY_AT: "2026-09-19T13:04:00.000Z",
    LIOS_BUNDLED_PYTHON_SIDECAR: "present",
  });
  assert.equal(snapshot.rows.find((row) => row.id === "desktop:native-secret-custody")?.state, "verified");
  assert.equal(snapshot.rows.find((row) => row.id === "desktop:bundled-python-sidecar")?.state, "verified");
});

test("P2 external evidence timestamps promote only their exact rows", () => {
  const snapshot = buildDesktopAcceptanceSnapshot(new Date(), {
    LIOS_P2_MAC_SIGNING_EVIDENCE_AT: "2026-09-19T13:10:00.000Z",
    LIOS_P2_WINDOWS_CLEAN_INSTALL_EVIDENCE_AT: "2026-09-19T13:11:00.000Z",
  });
  assert.equal(snapshot.rows.find((row) => row.id === "desktop:macos-signed-notarized")?.state, "verified");
  assert.equal(snapshot.rows.find((row) => row.id === "desktop:windows-clean-install")?.state, "verified");
  assert.equal(snapshot.rows.find((row) => row.id === "desktop:windows-authenticode")?.state, "blocked");
});
