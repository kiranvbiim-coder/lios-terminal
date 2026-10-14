import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopAcceptanceRow, DesktopAcceptanceSnapshot } from "./desktopAcceptance";
import type { SecurityAcceptanceRow, SecurityAcceptanceSnapshot } from "./securityAcceptance";
import { composeP7ReleaseReadiness } from "./p7ReleaseReadiness";

function desktop(externalVerified = false): DesktopAcceptanceSnapshot {
  const externalState = externalVerified ? "verified" as const : "blocked" as const;
  const external = (id: string, label: string, category: "custody" | "runtime" | "macos" | "windows" | "update" | "accessibility") => ({
    id, label, category, state: externalState, evidenceAt: externalVerified ? "2026-09-27T00:00:00.000Z" : null,
    evidence: ["fixture"], blockers: externalVerified ? [] : ["external fixture evidence required"], nextAction: "retain evidence",
  });
  const rows: DesktopAcceptanceRow[] = [
    { id: "desktop:workspace-recovery-contract", label: "recovery", category: "recovery" as const, state: "verified" as const, evidenceAt: null, evidence: ["fixture"], blockers: [], nextAction: "retain" },
    { id: "desktop:signed-release-workflows", label: "workflows", category: "recovery" as const, state: "verified" as const, evidenceAt: null, evidence: ["fixture"], blockers: [], nextAction: "retain" },
    external("desktop:native-secret-custody", "custody", "custody"),
    external("desktop:bundled-python-sidecar", "sidecar", "runtime"),
    external("desktop:macos-signed-notarized", "mac signing", "macos"),
    external("desktop:windows-authenticode", "windows signing", "windows"),
    external("desktop:macos-clean-install", "mac install", "macos"),
    external("desktop:windows-clean-install", "win install", "windows"),
    external("desktop:macos-update-rollback", "mac update", "update"),
    external("desktop:windows-update-rollback", "win update", "update"),
    external("desktop:macos-accessibility", "voiceover", "accessibility"),
    external("desktop:windows-accessibility", "narrator", "accessibility"),
  ];
  const counts = {
    verified: rows.filter((row) => row.state === "verified").length,
    degraded: 0,
    blocked: rows.filter((row) => row.state === "blocked").length,
    total: rows.length,
  };
  return { contractVersion: "1.0.0", generatedAt: "2026-09-27T00:00:00.000Z", status: counts.blocked ? "partial" : "ready", counts, rows, externalBlockers: rows.flatMap((row) => row.blockers) };
}

function security(externalVerified = false, localBlocked = false): SecurityAcceptanceSnapshot {
  const rows: SecurityAcceptanceRow[] = [
    {
      id: "security:desktop-ipc",
      label: "IPC",
      category: "desktop" as const,
      state: localBlocked ? "blocked" as const : "verified" as const,
      evidenceAt: null,
      evidence: ["fixture"],
      blockers: localBlocked ? ["local security regression"] : [],
      nextAction: "retain",
    },
    ...["security:privacy-live-evidence", "security:independent-security-scan", "security:independent-review"].map((id) => ({
      id,
      label: id,
      category: id.includes("review") ? "external_review" as const : id.includes("scan") ? "supply_chain" as const : "privacy" as const,
      state: externalVerified ? "verified" as const : "blocked" as const,
      evidenceAt: externalVerified ? "2026-09-27T00:00:00.000Z" : null,
      evidence: ["fixture"],
      blockers: externalVerified ? [] : ["external security evidence required"],
      nextAction: "retain evidence",
    })),
  ];
  const counts = { verified: rows.filter((row) => row.state === "verified").length, blocked: rows.filter((row) => row.state === "blocked").length, total: rows.length };
  return { contractVersion: "1.0.0", generatedAt: "2026-09-27T00:00:00.000Z", status: counts.blocked ? "partial" : "ready", counts, rows, externalBlockers: rows.flatMap((row) => row.blockers) };
}

test("P7 distinguishes engineering completion from external release certification", () => {
  const result = composeP7ReleaseReadiness({
    generatedAt: "2026-09-27T00:00:00.000Z",
    security: security(false),
    desktop: desktop(false),
  });
  assert.equal(result.engineeringComplete, true);
  assert.equal(result.releaseCertified, false);
  assert.equal(result.status, "engineering_ready");
  assert.equal(result.counts.engineeringBlocked, 0);
  assert.ok(result.counts.externalRequired > 0);
  assert.ok(result.rows.some((row) => row.id === "p7:tenant-enterprise-deployment" && !row.requiredForRelease));
});

test("P7 becomes release-certified only when all generic release evidence is verified", () => {
  const result = composeP7ReleaseReadiness({
    generatedAt: "2026-09-27T00:00:00.000Z",
    security: security(true),
    desktop: desktop(true),
    finalReleaseEvidenceComplete: true,
    finalReleaseEvidenceAt: "2026-09-27T00:00:00.000Z",
  });
  assert.equal(result.engineeringComplete, true);
  assert.equal(result.releaseCertified, true);
  assert.equal(result.status, "release_certified");
});

test("P7 remains engineering-ready when partial platform evidence is green but the final typed bundle is absent", () => {
  const result = composeP7ReleaseReadiness({
    generatedAt: "2026-09-27T00:00:00.000Z",
    security: security(true),
    desktop: desktop(true),
  });
  assert.equal(result.engineeringComplete, true);
  assert.equal(result.releaseCertified, false);
  assert.equal(result.status, "engineering_ready");
  assert.ok(result.rows.some((row) => row.id === "p7:final-release-certification" && row.state === "external_required"));
});

test("P7 fails engineering completion on a local security regression", () => {
  const result = composeP7ReleaseReadiness({
    generatedAt: "2026-09-27T00:00:00.000Z",
    security: security(false, true),
    desktop: desktop(false),
  });
  assert.equal(result.engineeringComplete, false);
  assert.equal(result.releaseCertified, false);
  assert.equal(result.status, "engineering_blocked");
  assert.ok(result.engineeringBlockers.includes("local security regression"));
});
