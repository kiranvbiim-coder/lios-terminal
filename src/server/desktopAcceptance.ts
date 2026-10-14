export type DesktopAcceptanceCategory =
  | "custody"
  | "runtime"
  | "recovery"
  | "macos"
  | "windows"
  | "update"
  | "accessibility";

export type DesktopAcceptanceState = "verified" | "degraded" | "blocked";

export interface DesktopAcceptanceRow {
  id: string;
  label: string;
  category: DesktopAcceptanceCategory;
  state: DesktopAcceptanceState;
  evidenceAt: string | null;
  evidence: string[];
  blockers: string[];
  nextAction: string;
}

export interface DesktopAcceptanceSnapshot {
  contractVersion: "1.0.0";
  generatedAt: string;
  status: "ready" | "partial";
  counts: { verified: number; degraded: number; blocked: number; total: number };
  rows: DesktopAcceptanceRow[];
  externalBlockers: string[];
}

function timestamp(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function externalEvidenceRow(
  env: NodeJS.ProcessEnv,
  input: {
    id: string;
    label: string;
    category: DesktopAcceptanceCategory;
    envKey: string;
    evidence: string[];
    blocker: string;
    nextAction: string;
  },
): DesktopAcceptanceRow {
  const evidenceAt = timestamp(env[input.envKey]);
  if (evidenceAt) {
    return {
      id: input.id,
      label: input.label,
      category: input.category,
      state: "verified",
      evidenceAt,
      evidence: input.evidence,
      blockers: [],
      nextAction: "Retain the referenced release evidence and rerun this acceptance on every new release candidate.",
    };
  }
  return {
    id: input.id,
    label: input.label,
    category: input.category,
    state: "blocked",
    evidenceAt: null,
    evidence: input.evidence,
    blockers: [input.blocker],
    nextAction: input.nextAction,
  };
}

export function buildDesktopAcceptanceSnapshot(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): DesktopAcceptanceSnapshot {
  const rows: DesktopAcceptanceRow[] = [];

  const custodyAt = timestamp(env.LIOS_NATIVE_SECRET_CUSTODY_AT);
  const custodyMode = env.LIOS_NATIVE_SECRET_CUSTODY?.trim();
  if (env.LIOS_DESKTOP_PACKAGED === "true" && custodyMode === "native_protected" && custodyAt) {
    rows.push({
      id: "desktop:native-secret-custody",
      label: "Native OS secret custody",
      category: "custody",
      state: "verified",
      evidenceAt: custodyAt,
      evidence: ["Packaged Electron runtime reported a successful safeStorage round-trip for the local vault master secret."],
      blockers: [],
      nextAction: "Repeat the packaged self-test on every supported release platform.",
    });
  } else {
    rows.push({
      id: "desktop:native-secret-custody",
      label: "Native OS secret custody",
      category: "custody",
      state: "blocked",
      evidenceAt: custodyAt,
      evidence: ["desktopSecretCustody.cjs has deterministic round-trip coverage and never treats fallback/env override as native protection."],
      blockers: [env.LIOS_DESKTOP_PACKAGED === "true"
        ? `Packaged runtime has not reported native_protected custody (current mode: ${custodyMode || "unset"}).`
        : "Native safeStorage evidence requires the packaged desktop runtime."],
      nextAction: "Run the signed packaged application with --desktop-self-test on macOS and Windows.",
    });
  }

  if (env.LIOS_DESKTOP_PACKAGED === "true" && env.LIOS_BUNDLED_PYTHON_SIDECAR === "present") {
    rows.push({
      id: "desktop:bundled-python-sidecar",
      label: "Self-contained Python analytics sidecar",
      category: "runtime",
      state: "verified",
      evidenceAt: custodyAt,
      evidence: ["Packaged application reports the frozen Python sidecar is present in application resources."],
      blockers: [],
      nextAction: "Retain clean-machine sidecar health evidence for each signed platform artifact.",
    });
  } else {
    rows.push({
      id: "desktop:bundled-python-sidecar",
      label: "Self-contained Python analytics sidecar",
      category: "runtime",
      state: "blocked",
      evidenceAt: null,
      evidence: ["Signed distribution builds require npm run python:sidecar:build and package python-sidecar-dist into application resources."],
      blockers: ["Packaged runtime has not reported the bundled Python sidecar as present."],
      nextAction: "Build the target-platform frozen sidecar and run the packaged sidecar health probe.",
    });
  }

  rows.push({
    id: "desktop:workspace-recovery-contract",
    label: "Workspace backup and restore integrity",
    category: "recovery",
    state: "verified",
    evidenceAt: null,
    evidence: [
      "The portable archive (server/backupArchive.ts) verifies every entry against a manifest after creation and restores through a staged, transactional import.",
      "desktopSelfTest.cjs performs a write, backup, corruption, restore, and byte-for-byte recovery probe.",
    ],
    blockers: [],
    nextAction: "Exercise the same recovery probe from every signed clean-install artifact.",
  });

  rows.push({
    id: "desktop:signed-release-workflows",
    label: "Signed platform release workflow contract",
    category: "recovery",
    state: "verified",
    evidenceAt: null,
    evidence: [
      "macOS workflow enforces Developer ID signing, hardened runtime, notarization, Gatekeeper and stapling.",
      "Windows workflow enforces forceCodeSigning and Authenticode verification.",
      "Both workflows verify the frozen Python sidecar and packaged desktop self-test before publishing evidence.",
    ],
    blockers: [],
    nextAction: "Execute the workflows with approved production signing credentials.",
  });

  rows.push(externalEvidenceRow(env, {
    id: "desktop:macos-signed-notarized",
    label: "macOS signed + notarized artifact",
    category: "macos",
    envKey: "LIOS_P2_MAC_SIGNING_EVIDENCE_AT",
    evidence: ["Production release workflow verifies codesign, Gatekeeper, stapler validation and DMG install assessment."],
    blocker: "No dated macOS Developer ID/notarization evidence has been recorded for the current release candidate.",
    nextAction: "Run LiOS Production Release Readiness with Apple signing/notarization credentials on the exact release tag.",
  }));

  rows.push(externalEvidenceRow(env, {
    id: "desktop:windows-authenticode",
    label: "Windows Authenticode-signed installer",
    category: "windows",
    envKey: "LIOS_P2_WINDOWS_SIGNING_EVIDENCE_AT",
    evidence: ["Windows release workflow verifies the installer and bundled Python sidecar with Get-AuthenticodeSignature."],
    blocker: "No dated valid Windows Authenticode evidence has been recorded for the current release candidate.",
    nextAction: "Run LiOS Windows Desktop Release with the approved Windows signing certificate.",
  }));

  rows.push(externalEvidenceRow(env, {
    id: "desktop:macos-clean-install",
    label: "macOS clean-machine install acceptance",
    category: "macos",
    envKey: "LIOS_P2_MAC_CLEAN_INSTALL_EVIDENCE_AT",
    evidence: ["A dedicated macos-15 job downloads the published DMG, verifies checksum/Gatekeeper, copies the app, and runs --desktop-self-test."],
    blocker: "No dated clean-machine macOS self-test evidence is recorded.",
    nextAction: "Complete the clean-install-macos job for the signed release tag and retain its evidence JSON.",
  }));

  rows.push(externalEvidenceRow(env, {
    id: "desktop:windows-clean-install",
    label: "Windows clean-machine install acceptance",
    category: "windows",
    envKey: "LIOS_P2_WINDOWS_CLEAN_INSTALL_EVIDENCE_AT",
    evidence: ["A dedicated Windows job downloads the signed installer, verifies checksum/Authenticode, installs silently, verifies the installed sidecar signature, and runs --desktop-self-test."],
    blocker: "No dated clean-machine Windows self-test evidence is recorded.",
    nextAction: "Complete the clean-install-windows job for the signed release tag and retain its evidence JSON.",
  }));

  rows.push(externalEvidenceRow(env, {
    id: "desktop:macos-update-rollback",
    label: "macOS upgrade/update/rollback acceptance",
    category: "update",
    envKey: "LIOS_P2_MAC_UPDATE_ROLLBACK_EVIDENCE_AT",
    evidence: ["Updater rejects insecure feeds/downgrades; workspace backup/restore is integrity checked."],
    blocker: "A real previous-to-current signed macOS update and rollback exercise has not been recorded.",
    nextAction: "Use two signed release versions and the production HTTPS feed to exercise upgrade, failed update, rollback and workspace recovery.",
  }));

  rows.push(externalEvidenceRow(env, {
    id: "desktop:windows-update-rollback",
    label: "Windows upgrade/update/rollback acceptance",
    category: "update",
    envKey: "LIOS_P2_WINDOWS_UPDATE_ROLLBACK_EVIDENCE_AT",
    evidence: ["Updater rejects insecure feeds/downgrades; workspace backup/restore is integrity checked."],
    blocker: "A real previous-to-current signed Windows update and rollback exercise has not been recorded.",
    nextAction: "Use two signed release versions and the production HTTPS feed to exercise upgrade, failed update, rollback and workspace recovery.",
  }));

  rows.push(externalEvidenceRow(env, {
    id: "desktop:macos-accessibility",
    label: "macOS keyboard + VoiceOver acceptance",
    category: "accessibility",
    envKey: "LIOS_P2_MAC_ACCESSIBILITY_EVIDENCE_AT",
    evidence: ["Semantic/keyboard contracts remain part of V4-28; manual assistive-technology evidence is intentionally separate from source tests."],
    blocker: "No dated VoiceOver + keyboard acceptance run is recorded for the packaged macOS app.",
    nextAction: "Run the P2 accessibility script/checklist with VoiceOver on the signed macOS build and retain the evidence.",
  }));

  rows.push(externalEvidenceRow(env, {
    id: "desktop:windows-accessibility",
    label: "Windows keyboard + Narrator acceptance",
    category: "accessibility",
    envKey: "LIOS_P2_WINDOWS_ACCESSIBILITY_EVIDENCE_AT",
    evidence: ["Semantic/keyboard contracts remain part of V4-28; manual assistive-technology evidence is intentionally separate from source tests."],
    blocker: "No dated Narrator + keyboard acceptance run is recorded for the packaged Windows app.",
    nextAction: "Run the P2 accessibility script/checklist with Narrator on the signed Windows build and retain the evidence.",
  }));

  const counts = {
    verified: rows.filter((row) => row.state === "verified").length,
    degraded: rows.filter((row) => row.state === "degraded").length,
    blocked: rows.filter((row) => row.state === "blocked").length,
    total: rows.length,
  };
  return {
    contractVersion: "1.0.0",
    generatedAt: now.toISOString(),
    status: counts.blocked || counts.degraded ? "partial" : "ready",
    counts,
    rows,
    externalBlockers: [...new Set(rows.flatMap((row) => row.blockers))],
  };
}
