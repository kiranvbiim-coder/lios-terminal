import fs from "node:fs";
import path from "node:path";
import {
  P7_RELEASE_SCHEMA_VERSION,
  p7ReleaseReadinessSnapshotSchema,
  type P7ReleaseReadinessRow,
  type P7ReleaseReadinessSnapshot,
} from "@shared/p7ReleaseContracts";
import { P14_RELEASE_EVIDENCE_ENV, p14ReleaseEvidenceSchema, type P14ReleaseEvidence } from "@shared/p14ReleaseEvidence";
import {
  buildDesktopAcceptanceSnapshot,
  type DesktopAcceptanceRow,
  type DesktopAcceptanceSnapshot,
} from "./desktopAcceptance";
import {
  buildSecurityAcceptanceSnapshot,
  type SecurityAcceptanceSnapshot,
} from "./securityAcceptance";

const SECURITY_EXTERNAL_IDS = new Set([
  "security:native-secret-custody",
  "security:privacy-live-evidence",
  "security:independent-security-scan",
  "security:independent-review",
]);

const DESKTOP_ENGINEERING_IDS = new Set([
  "desktop:workspace-recovery-contract",
  "desktop:signed-release-workflows",
]);

const DESKTOP_EXTERNAL_IDS = new Set([
  "desktop:native-secret-custody",
  "desktop:bundled-python-sidecar",
  "desktop:macos-signed-notarized",
  "desktop:windows-authenticode",
  "desktop:macos-clean-install",
  "desktop:windows-clean-install",
  "desktop:macos-update-rollback",
  "desktop:windows-update-rollback",
  "desktop:macos-accessibility",
  "desktop:windows-accessibility",
]);

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function engineeringRow(input: Omit<P7ReleaseReadinessRow, "owner" | "requiredForEngineering" | "requiredForRelease"> & {
  owner?: "engineering";
}): P7ReleaseReadinessRow {
  return {
    ...input,
    owner: "engineering",
    requiredForEngineering: true,
    requiredForRelease: true,
  };
}

function staticEngineeringRows(): P7ReleaseReadinessRow[] {
  return [
    engineeringRow({
      id: "p7:identity-sso-runtime",
      label: "Enterprise identity and SSO runtime",
      category: "identity_sso",
      state: "ready",
      evidenceAt: null,
      evidence: [
        "Canonical enterprise policy supports disabled/OIDC/SAML modes with fail-closed readiness.",
        "OIDC uses Authorization Code + PKCE, issuer/audience/nonce/signature checks and one-time desktop device authorization.",
        "SAML request state, signed relay state, assertion verifier boundary and one-time consumption are implemented.",
      ],
      blockers: [],
      nextAction: "Configure and verify the customer IdP during tenant deployment; do not store IdP secrets in Project state.",
      sourceRefs: ["shared/enterpriseContracts.ts", "server/enterpriseSso.ts", "server/desktopOidcPkce.ts"],
    }),
    engineeringRow({
      id: "p7:device-session-controls",
      label: "Device authorization and session controls",
      category: "device_session",
      state: "ready",
      evidenceAt: null,
      evidence: [
        "Identity, device authorization, session revocation and tenant ownership remain separate fail-closed controls.",
        "Enterprise policy can require device authorization and bound per-user device leases.",
        "Session restoration distinguishes online, offline, re-authentication and revoked states.",
      ],
      blockers: [],
      nextAction: "Keep device/session revocation tests mandatory when identity or license flows change.",
      sourceRefs: ["shared/identityContracts.ts", "server/sessionRestoration.ts", "server/enterpriseSso.ts"],
    }),
    engineeringRow({
      id: "p7:offline-policy",
      label: "Signed offline entitlement policy",
      category: "offline_policy",
      state: "ready",
      evidenceAt: null,
      evidence: [
        "Offline access is expiry-bounded, device-bound and feature-scoped.",
        "Offline lease cache and restoration fail closed on revoked, expired, wrong-device or unscoped leases.",
      ],
      blockers: [],
      nextAction: "Rotate signing material through the existing license control plane and preserve fail-closed offline tests.",
      sourceRefs: ["server/licenseLease.ts", "server/offlineLeaseCache.ts", "server/sessionRestoration.ts"],
    }),
    engineeringRow({
      id: "p7:performance-contract",
      label: "Desktop and professional performance budgets",
      category: "performance",
      state: "ready",
      evidenceAt: null,
      evidence: [
        "Desktop startup/readiness/workspace budgets are explicit.",
        "Artifact and calculation performance tests remain release-gated.",
        "Packaged performance probes are required on signed release artifacts.",
      ],
      blockers: [],
      nextAction: "Retain the packaged performance evidence for every release candidate.",
      sourceRefs: ["server/desktopHardening.ts", "server/artifactPerformance.test.ts", "client/src/lib/calculationPerformance.test.ts", "script/validate_p14_packaged_performance_probe.cjs"],
    }),
    engineeringRow({
      id: "p7:accessibility-source",
      label: "Keyboard, semantic and reduced-motion accessibility contract",
      category: "accessibility",
      state: "ready",
      evidenceAt: null,
      evidence: [
        "Focus indicators, reduced motion, semantic dialog/control labels and keyboard navigation are source-gated.",
        "Project shell and Living Workspace preserve accessible control ownership.",
      ],
      blockers: [],
      nextAction: "Complete signed-package VoiceOver, Narrator and keyboard-only walkthroughs before release certification.",
      sourceRefs: ["script/validate_desktop_accessibility.ts", "client/src/immersive-terminal.css", "client/src/terminal-ux-stabilization.css"],
    }),
    engineeringRow({
      id: "p7:release-rights-source",
      label: "Supply-chain, license and release-rights governance",
      category: "release_rights",
      state: "ready",
      evidenceAt: null,
      evidence: [
        "Production dependency, Python vulnerability, static license, OSS and release-rights audits are release gates.",
        "Software licenses, hosted data/API rights, model weights, datasets and trademarks/assets are reviewed separately.",
      ],
      blockers: [],
      nextAction: "Keep release-rights evidence tied to the exact source/release tag.",
      sourceRefs: ["third_party/release-rights-matrix.json", "script/audit_p10_release.ts", "script/audit_production_dependencies.mjs"],
    }),
  ];
}

function securityEngineeringRows(snapshot: SecurityAcceptanceSnapshot): P7ReleaseReadinessRow[] {
  return snapshot.rows
    .filter((row) => !SECURITY_EXTERNAL_IDS.has(row.id))
    .map((row) => engineeringRow({
      id: "p7:" + row.id,
      label: row.label,
      category: "security_privacy",
      state: row.state === "verified" ? "ready" : "blocked",
      evidenceAt: row.evidenceAt,
      evidence: row.evidence,
      blockers: row.blockers,
      nextAction: row.nextAction,
      sourceRefs: ["server/securityAcceptance.ts"],
    }));
}

function desktopEngineeringRows(snapshot: DesktopAcceptanceSnapshot): P7ReleaseReadinessRow[] {
  return snapshot.rows
    .filter((row) => DESKTOP_ENGINEERING_IDS.has(row.id))
    .map((row) => engineeringRow({
      id: "p7:" + row.id,
      label: row.label,
      category: "packaging_recovery",
      state: row.state === "verified" ? "ready" : "blocked",
      evidenceAt: row.evidenceAt,
      evidence: row.evidence,
      blockers: row.blockers,
      nextAction: row.nextAction,
      sourceRefs: ["server/desktopAcceptance.ts"],
    }));
}

function desktopExternalCategory(row: DesktopAcceptanceRow): P7ReleaseReadinessRow["category"] {
  if (row.category === "accessibility") return "accessibility";
  if (row.category === "custody") return "security_privacy";
  if (row.category === "runtime") return "packaging_recovery";
  return "packaging_recovery";
}

function desktopExternalRows(snapshot: DesktopAcceptanceSnapshot): P7ReleaseReadinessRow[] {
  return snapshot.rows
    .filter((row) => DESKTOP_EXTERNAL_IDS.has(row.id))
    .map((row) => ({
      id: "p7:" + row.id,
      label: row.label,
      category: desktopExternalCategory(row),
      owner: "release_owner",
      state: row.state === "verified" ? "verified" : "external_required",
      requiredForEngineering: false,
      requiredForRelease: true,
      evidenceAt: row.evidenceAt,
      evidence: row.evidence,
      blockers: row.blockers,
      nextAction: row.nextAction,
      sourceRefs: ["server/desktopAcceptance.ts"],
    }));
}

function securityExternalRows(snapshot: SecurityAcceptanceSnapshot): P7ReleaseReadinessRow[] {
  return snapshot.rows
    .filter((row) => SECURITY_EXTERNAL_IDS.has(row.id) && row.id !== "security:native-secret-custody")
    .map((row) => ({
      id: "p7:" + row.id,
      label: row.label,
      category: "security_privacy",
      owner: "release_owner",
      state: row.state === "verified" ? "verified" : "external_required",
      requiredForEngineering: false,
      requiredForRelease: true,
      evidenceAt: row.evidenceAt,
      evidence: row.evidence,
      blockers: row.blockers,
      nextAction: row.nextAction,
      sourceRefs: ["server/securityAcceptance.ts"],
    }));
}

function completeP14ReleaseEvidence(env: NodeJS.ProcessEnv): { complete: boolean; generatedAt: string | null } {
  const expectedVersion = env.LIOS_P7_RELEASE_VERSION?.trim();
  if (!expectedVersion) return { complete: false, generatedAt: null };
  const evidence: P14ReleaseEvidence[] = [];
  for (const [envName, category] of P14_RELEASE_EVIDENCE_ENV) {
    const raw = env[envName]?.trim();
    if (!raw) return { complete: false, generatedAt: null };
    try {
      const parsed = p14ReleaseEvidenceSchema.parse(JSON.parse(fs.readFileSync(path.resolve(raw), "utf8")));
      if (parsed.category !== category) return { complete: false, generatedAt: null };
      evidence.push(parsed);
    } catch {
      return { complete: false, generatedAt: null };
    }
  }
  const releaseTags = new Set(evidence.map((item) => item.releaseTag));
  const packageVersions = new Set(evidence.map((item) => item.packageVersion));
  if (releaseTags.size !== 1 || packageVersions.size !== 1 || !packageVersions.has(expectedVersion.replace(/^v/, ""))) {
    return { complete: false, generatedAt: null };
  }
  const latest = evidence.map((item) => item.generatedAt).sort().at(-1) ?? null;
  return { complete: true, generatedAt: latest };
}

function finalCertificationRow(complete: boolean, evidenceAt: string | null): P7ReleaseReadinessRow {
  return {
    id: "p7:final-release-certification",
    label: "Complete typed final-release evidence bundle",
    category: "packaging_recovery",
    owner: "release_owner",
    state: complete ? "verified" : "external_required",
    requiredForEngineering: false,
    requiredForRelease: true,
    evidenceAt,
    evidence: [
      "Final certification reuses all typed P14 evidence categories for one exact release tag/version.",
      "The bundle includes clean install, update/rollback, pack lifecycle, workspace restore, recovery, security/privacy, release rights, performance, VoiceOver, Narrator, keyboard, first-use and flagship evidence.",
    ],
    blockers: complete ? [] : ["The complete typed P14 final-release evidence bundle is not present in this runtime."],
    nextAction: "Run the final P14 certification workflow for the exact signed release candidate.",
    sourceRefs: ["shared/p14ReleaseEvidence.ts", ".github/workflows/p14-release-certification.yml"],
  };
}

function tenantDeploymentRow(): P7ReleaseReadinessRow {
  return {
    id: "p7:tenant-enterprise-deployment",
    label: "Tenant IdP/private deployment verification",
    category: "enterprise_deployment",
    owner: "enterprise_admin",
    state: "external_required",
    requiredForEngineering: false,
    requiredForRelease: false,
    evidenceAt: null,
    evidence: [
      "Enterprise SSO and private deployment readiness/verification endpoints are implemented.",
      "Each customer deployment supplies its own IdP, secrets, network endpoint and deployment evidence.",
    ],
    blockers: ["Tenant-specific IdP/private-cloud configuration is intentionally deployment-bound."],
    nextAction: "Verify SSO and private deployment from the Enterprise Governance surface during customer deployment.",
    sourceRefs: ["server/enterpriseRoutes.ts", "server/enterpriseSso.ts", "server/enterpriseDeployment.ts"],
  };
}

export function composeP7ReleaseReadiness(input: {
  generatedAt: string;
  security: SecurityAcceptanceSnapshot;
  desktop: DesktopAcceptanceSnapshot;
  finalReleaseEvidenceComplete?: boolean;
  finalReleaseEvidenceAt?: string | null;
}): P7ReleaseReadinessSnapshot {
  const rows = [
    ...staticEngineeringRows(),
    ...securityEngineeringRows(input.security),
    ...desktopEngineeringRows(input.desktop),
    ...desktopExternalRows(input.desktop),
    ...securityExternalRows(input.security),
    finalCertificationRow(input.finalReleaseEvidenceComplete ?? false, input.finalReleaseEvidenceAt ?? null),
    tenantDeploymentRow(),
  ];

  const engineeringRequired = rows.filter((row) => row.requiredForEngineering);
  const releaseRequired = rows.filter((row) => row.requiredForRelease);
  const engineeringComplete = engineeringRequired.every((row) => row.state === "ready" || row.state === "verified");
  const releaseCertified = engineeringComplete && releaseRequired.every((row) => row.state === "ready" || row.state === "verified");
  const engineeringBlockers = unique(engineeringRequired.filter((row) => row.state === "blocked" || row.state === "external_required").flatMap((row) => row.blockers.length ? row.blockers : [row.label + " is not engineering-ready."]));
  const externalBlockers = unique(rows.filter((row) => row.owner !== "engineering" && row.state === "external_required").flatMap((row) => row.blockers.length ? row.blockers : [row.label + " requires external evidence."]));

  return p7ReleaseReadinessSnapshotSchema.parse({
    schemaVersion: P7_RELEASE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    status: releaseCertified ? "release_certified" : engineeringComplete ? "engineering_ready" : "engineering_blocked",
    engineeringComplete,
    releaseCertified,
    counts: {
      engineeringReady: engineeringRequired.filter((row) => row.state === "ready" || row.state === "verified").length,
      engineeringBlocked: engineeringRequired.filter((row) => row.state === "blocked" || row.state === "external_required").length,
      releaseVerified: releaseRequired.filter((row) => row.state === "ready" || row.state === "verified").length,
      externalRequired: rows.filter((row) => row.state === "external_required").length,
      total: rows.length,
    },
    rows,
    engineeringBlockers,
    externalBlockers,
    notes: [
      "Engineering completion and release certification are deliberately separate.",
      "Real signing/notarization, clean-machine installation, assistive-technology, production privacy/security-review and tenant deployment evidence are never fabricated.",
      "Active P7 composes historical P10/P14/security/enterprise controls; it does not create a second updater, recovery system, identity stack or release pipeline.",
    ],
  });
}

export async function buildP7ReleaseReadiness(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<P7ReleaseReadinessSnapshot> {
  const finalEvidence = completeP14ReleaseEvidence(env);
  const [security, desktop] = await Promise.all([
    buildSecurityAcceptanceSnapshot(now, env),
    Promise.resolve(buildDesktopAcceptanceSnapshot(now, env)),
  ]);
  return composeP7ReleaseReadiness({
    generatedAt: now.toISOString(),
    security,
    desktop,
    finalReleaseEvidenceComplete: finalEvidence.complete,
    finalReleaseEvidenceAt: finalEvidence.generatedAt,
  });
}
