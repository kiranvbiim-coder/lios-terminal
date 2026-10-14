/**
 * V4-25 through V4-29 operational readiness contracts.
 *
 * These rows deliberately distinguish code/evidence that is complete from
 * gates that require a real provider, signed artifact, or deployment. The
 * readiness surface is therefore useful before production credentials exist
 * and cannot accidentally turn an unavailable external dependency into a
 * green release claim.
 *
 * Status: this is supporting operational-evidence detail for the canonical
 * roadmap's P10/P14 production-hardening and release-qualification scope
 * (docs/LIOS_EXECUTION_ROADMAP.md). The `V4-*`/`LV4-*` identifiers below are
 * a frozen legacy evidence-ledger namespace from the initial hardening pass
 * — do not add new items under `LV3-*`/`LV4-*` numbering (AGENTS.md §5).
 * New operational-readiness work uses canonical `LIOS-P10-*`/`LIOS-P14-*`
 * task IDs and, if it needs a machine-readable evidence row, extends this
 * contract's shape under those IDs rather than the V4-* phase enum below.
 */

export const V4_OPERATIONAL_CONTRACT_VERSION = "1.0.0" as const;

export type OperationalStatus = "ready" | "partial" | "blocked";
export type OperationalPhase = "V4-25" | "V4-26" | "V4-27" | "V4-28" | "V4-29";

export interface V4OperationalItem {
  id: string;
  phase: OperationalPhase;
  title: string;
  status: OperationalStatus;
  evidence: string[];
  blockers: string[];
  nextAction: string;
}

export interface V4OperationalPhaseSummary {
  phase: OperationalPhase;
  status: OperationalStatus;
  ready: number;
  partial: number;
  blocked: number;
  total: number;
}

export interface V4EnvironmentReadiness {
  databaseConfigured: boolean;
  hostedVaultConfigured: boolean;
  updateFeedConfigured: boolean;
  releaseChannel: "stable" | "beta" | "unset";
  macSigningConfigured: boolean;
  windowsSigningConfigured: boolean;
  websiteDownloadConfigured: boolean;
}

export interface V4OperationalReadiness {
  contractVersion: typeof V4_OPERATIONAL_CONTRACT_VERSION;
  generatedAt: string;
  status: OperationalStatus;
  items: V4OperationalItem[];
  phases: V4OperationalPhaseSummary[];
  environment: V4EnvironmentReadiness;
  blockers: string[];
  evidence: string[];
}

const ready = (id: string, phase: OperationalPhase, title: string, evidence: string[], nextAction = "Keep covered by the existing automated gate."): V4OperationalItem => ({ id, phase, title, status: "ready", evidence, blockers: [], nextAction });
const partial = (id: string, phase: OperationalPhase, title: string, evidence: string[], blockers: string[], nextAction: string): V4OperationalItem => ({ id, phase, title, status: "partial", evidence, blockers, nextAction });

/**
 * Local evidence-backed inventory for every item in the final five waves.
 * `partial` means the local contract is complete but the remaining gate is
 * external; it is not a failed implementation.
 */
export const V4_OPERATIONAL_ITEMS: readonly V4OperationalItem[] = Object.freeze([
  ready("LV4-25-01", "V4-25", "V4 threat model refresh", ["docs/technical/LIOS_V4_SECURITY_READINESS.md", "src/shared/v4OperationalContracts.ts"]),
  ready("LV4-25-02", "V4-25", "Renderer/main IPC security review", ["src/main.cjs", "src/preload.cjs", "src/desktopIpcSecurity.cjs", "src/desktopIpcSecurity.test.cjs", "src/server/securityHeaders.ts"]),
  partial("LV4-25-03", "V4-25", "OS keychain + encrypted fallback", ["src/server/credentialVault.ts", "src/server/organizationCredentialVault.ts", "src/desktopSecretCustody.cjs", "src/desktopSelfTest.cjs", "src/server/desktopAcceptance.ts"], ["Electron safeStorage binding and round-trip self-test are implemented; signed macOS/Windows packaged evidence remains external."], "Run --desktop-self-test on each signed target-platform artifact and retain the native_protected evidence."),
  ready("LV4-25-04", "V4-25", "Secret redaction standard", ["src/server/governanceEngine.ts", "src/server/governanceEngine.test.ts", "src/desktopLogRedaction.cjs", "src/desktopLogRedaction.test.cjs"]),
  ready("LV4-25-05", "V4-25", "OAuth least-privilege review", ["src/server/waveERoutes.ts", "src/server/sourceConnectionRoutes.ts", "src/shared/v4OperationalContracts.ts"]),
  ready("LV4-25-06", "V4-25", "Control-plane auth/tenant/RLS review", ["src/server/auth.ts", "src/server/runtimeSecurity.ts", "src/server/tenantDb.ts", "src/server/rlsChildPolicyContract.test.ts", "src/server/rlsLiveAttackPlan.test.ts"]),
  ready("LV4-25-08", "V4-25", "Signed-entitlement tamper review", ["src/server/licenseLease.ts", "src/server/modelAssuranceIntegrity.ts", "src/server/commercialRuntime.test.ts"]),
  ready("LV4-25-09", "V4-25", "Network abuse/moderation threat model", ["src/server/waveERoutes.ts", "src/server/rateLimit.ts", "src/server/apiConnector.ts", "src/server/databaseConnector.ts", "src/server/privacyBoundary.test.ts", "src/shared/v4OperationalContracts.ts"]),
  partial("LV4-25-10", "V4-25", "Data-export/deletion controls", ["src/shared/enterpriseContracts.ts", "src/server/enterpriseRoutes.ts", "src/server/productionControlPlane.ts", "src/server/productionControlRoutes.ts", "src/server/productionAcceptance.ts"], ["Retention/deletion/export-custody controls are implemented; dated production purge/deletion/export receipts remain deployment evidence."], "Deploy the hosted worker, exercise an approved organization purge and customer export, and retain the generated receipts."),
  partial("LV4-25-11", "V4-25", "Dependency/security audit", ["src/package-lock.json", "src/server/securityAcceptance.ts", "src/script/validate_security_acceptance.ts"], ["The built-in production dependency audit is implemented (its private release-gate workflow is not part of the public source distribution); an independent third-party scan/remediation attestation remains external evidence."], "Run the approved independent scanner against the release candidate and retain the report plus remediation disposition."),
  partial("LV4-25-12", "V4-25", "External security review readiness", ["docs/technical/LIOS_V4_SECURITY_READINESS.md", "docs/technical/LIOS_V4_P5_SECURITY_RUNBOOK.md", "docs/technical/SECURITY_TEST_MATRIX.md", "src/server/securityAcceptance.ts"], ["Independent external review has not been performed."], "Complete an independent security review/penetration test and retain findings plus remediation disposition."),

  ready("LV4-26-01", "V4-26", "Performance budget definition", ["src/server/desktopHardening.ts", "src/server/desktopHardening.test.ts"]),
  partial("LV4-26-02", "V4-26", "Global instrument index performance", ["src/server/globalInstrumentMasterRoutes.ts", "src/shared/v4OperationalContracts.ts"], ["Production-scale index benchmark data is not available offline."], "Run the production-sized benchmark and record p95/p99 results."),
  ready("LV4-26-03", "V4-26", "Provider federation latency/caching", ["src/server/providerUtils.ts", "src/server/keyedQuoteAdapters.ts"]),
  ready("LV4-26-04", "V4-26", "Startup optimization", ["src/server/desktopHardening.ts", "src/server/readinessRoutes.ts"]),
  partial("LV4-26-05", "V4-26", "Pulse first-useful-render optimization", ["src/client/src/lib/terminalTelemetry.ts", "src/server/productionControlPlane.ts", "src/server/productionAcceptance.ts"], ["Privacy-safe aggregate diagnostics transport is implemented; real-user timing samples still require an enabled production deployment."], "Enable the reviewed diagnostics sink and collect target-deployment p95/p99 timing evidence."),
  ready("LV4-26-06", "V4-26", "AI/tool latency instrumentation", ["src/server/brainService.ts", "src/server/calculationJobService.ts", "src/shared/v4OperationalContracts.ts"]),
  ready("LV4-26-07", "V4-26", "Engine/run latency instrumentation", ["src/server/calculationJobService.ts", "src/server/desktopHardening.ts"]),
  ready("LV4-26-08", "V4-26", "Workspace backup/restore", ["src/server/backupArchive.ts", "src/server/backupArchive.test.ts", "src/server/backupService.ts", "src/server/pgliteBackup.ts"]),
  ready("LV4-26-09", "V4-26", "Crash recovery", ["src/client/src/components/terminal/PanelErrorBoundary.tsx", "src/server/calculationJobService.ts"]),
  ready("LV4-26-10", "V4-26", "Provider retry/backoff/degraded UX", ["src/server/providerUtils.ts", "src/server/desktopHardening.ts", "src/server/waveERoutes.ts"]),
  ready("LV4-26-11", "V4-26", "Migration recovery/rollback", ["src/server/pgliteBackup.ts", "src/server/db.ts", "src/server/dbMigration.test.ts"]),
  partial("LV4-26-12", "V4-26", "Updater rollback/recovery", ["src/desktopUpdater.cjs", "src/desktopUpdater.test.cjs", "src/server/backupArchive.ts", "src/desktopSelfTest.cjs", "src/server/desktopAcceptance.ts"], ["Updater and recovery contracts are implemented; a real previous-to-current signed update and rollback still requires release infrastructure."], "Publish two signed versions and exercise upgrade, failed update, rollback, backup and restore on each supported platform."),

  ready("LV4-27-01", "V4-27", "Error correlation/log contract", ["src/shared/v4OperationalContracts.ts", "src/server/auditEvents.ts"]),
  ready("LV4-27-02", "V4-27", "Privacy-respecting telemetry policy", ["src/client/src/lib/terminalTelemetry.ts", "src/shared/v4OperationalContracts.ts"]),
  partial("LV4-27-03", "V4-27", "Crash-report integration", ["src/client/src/main.tsx", "src/client/src/lib/terminalTelemetry.ts", "src/server/productionControlPlane.ts", "src/server/productionAcceptance.ts"], ["Redacted crash-fingerprint collection and retention are implemented; dated production crash evidence requires diagnostics to be enabled and exercised."], "Enable the reviewed diagnostics sink and verify a fingerprint-only crash event in the target deployment."),
  ready("LV4-27-04", "V4-27", "Connector/sidecar health diagnostics", ["src/server/connectorProbes.ts", "src/server/desktopHardening.ts", "src/shared/v4OperationalContracts.ts"]),
  ready("LV4-27-05", "V4-27", "Entitlement/billing diagnostic view", ["src/client/src/components/panels/AdminConsolePanel.tsx", "src/server/adminRoutes.ts", "src/shared/commercialRuntime.ts"]),
  partial("LV4-27-06", "V4-27", "Updater diagnostic view", ["src/desktopUpdater.cjs", "src/server/productionControlPlane.ts", "src/server/productionAcceptance.ts"], ["Public distribution/update endpoints now have an active verification contract; a live signed feed and installed-app update evidence remain external."], "Publish the signed feed, run the distribution verifier, then retain installed update evidence."),
  ready("LV4-27-07", "V4-27", "Redacted support bundle", ["src/server/governanceEngine.ts", "src/server/governanceEngine.test.ts", "docs/technical/LIOS_V4_SECURITY_READINESS.md"]),
  ready("LV4-27-08", "V4-27", "Support troubleshooting documentation", ["docs/technical/LIOS_V4_SUPPORT_RUNBOOK.md", "src/shared/v4OperationalContracts.ts"]),

  partial("LV4-28-01", "V4-28", "OS/install matrix", ["docs/technical/P14_DESKTOP_LAUNCH_QUALIFICATION.md", "src/shared/v4OperationalContracts.ts", "src/server/desktopAcceptance.ts"], ["Clean-machine installer jobs exist only in the private release repository and are withheld from this public source distribution; execution requires real signed published artifacts."], "Run the signed macOS and Windows release workflows and retain clean-install evidence."),
  partial("LV4-28-02", "V4-28", "Commercial lifecycle matrix", ["src/shared/commercialRuntime.ts", "src/server/providerAcceptance.ts"], ["Live billing/provider evidence is external."], "Exercise trial, active, grace, hold, suspension, and termination against the live provider."),
  partial("LV4-28-03", "V4-28", "AI provider matrix", ["src/server/byoaiTransport.ts", "src/server/providerAcceptance.ts"], ["Provider credentials and endpoint availability are external."], "Run the matrix with each approved provider credential set."),
  partial("LV4-28-04", "V4-28", "Data provider/source matrix", ["src/server/providerUtils.ts", "src/server/providerAcceptance.ts"], ["Licensed/keyed provider coverage is external."], "Run provider fixtures and live-source checks for the configured deployment."),
  partial("LV4-28-05", "V4-28", "Global market/instrument matrix", ["src/server/globalInstrumentMasterRoutes.ts"], ["Global market data and exchange credentials are external."], "Execute region/exchange/currency coverage against the production catalog."),
  ready("LV4-28-06", "V4-28", "Analytics matrix", ["src/client/src/lib/quantModelCatalog.ts", "src/server/desktopHardening.ts"]),
  ready("LV4-28-07", "V4-28", "Pulse/Signals/stateful-intelligence matrix", ["src/server/waveDRoutes.ts"]),
  partial("LV4-28-08", "V4-28", "Communications matrix", ["src/server/waveERoutes.ts", "src/server/providerAcceptance.ts"], ["OAuth consent, SMTP, Slack, Teams, and desktop notification transports are external."], "Run transport-specific consent and delivery checks with approved credentials."),
  ready("LV4-28-09", "V4-28", "Network/collaboration matrix", ["src/server/waveERoutes.ts"]),
  ready("LV4-28-10", "V4-28", "Enterprise/security matrix", ["src/shared/enterpriseContracts.ts", "src/shared/v4OperationalContracts.ts"]),
  partial("LV4-28-11", "V4-28", "Accessibility/keyboard matrix", ["src/client/src/terminal-workstation-v8.css", "src/server/desktopAcceptance.ts", "docs/technical/LIOS_V4_P2_DESKTOP_ACCEPTANCE.md", "docs/technical/LIOS_V4_P2_ACCESSIBILITY_RUNBOOK.md", "src/script/validate_desktop_accessibility.ts"], ["VoiceOver/Narrator and keyboard-only acceptance require target-platform packaged execution."], "Run and retain macOS VoiceOver + keyboard and Windows Narrator + keyboard acceptance evidence."),
  partial("LV4-28-12", "V4-28", "Update/recovery matrix", ["src/desktopUpdater.cjs", "src/server/backupArchive.ts", "src/desktopSelfTest.cjs", "src/server/desktopAcceptance.ts"], ["Packaged recovery self-test is implemented; signed previous/current artifacts and the production update feed remain external."], "Exercise update, failed update, rollback, backup, and restore between two signed versions on each target OS."),
  partial("LV4-28-13", "V4-28", "Release-candidate sign-off report", ["docs/technical/P14_DESKTOP_LAUNCH_QUALIFICATION.md", "src/shared/v4OperationalContracts.ts"], ["Sign-off depends on the external qualification evidence above."], "Attach completed qualification evidence and obtain release-owner approval."),

  ready("LV4-29-01", "V4-29", "Final app/product naming metadata", ["src/package.json", "src/shared/v4OperationalContracts.ts"]),
  partial("LV4-29-02", "V4-29", "Windows code signing", ["src/script/release_preflight.ts", "docs/technical/LIOS_V4_RELEASE_READINESS.md", "src/server/desktopAcceptance.ts"], ["The signing workflow is withheld from this public source distribution. Signing, installer/sidecar Authenticode checks and clean-install workflow are implemented; the production certificate and signed execution remain external."], "Configure the approved Windows certificate, run the exact-tag workflow and retain Authenticode + clean-install evidence."),
  partial("LV4-29-03", "V4-29", "macOS signing/notarization/hardened runtime", ["src/script/release_preflight.ts", "docs/technical/LIOS_V4_RELEASE_READINESS.md", "src/server/desktopAcceptance.ts"], ["The notarization workflow is withheld from this public source distribution. Developer ID signing, hardened runtime, notarization, Gatekeeper/stapler verification and clean-install workflow are implemented; Apple credentials and signed execution remain external."], "Configure Apple signing/notarization, run the exact-tag workflow and retain notarization + clean-install evidence."),
  partial("LV4-29-04", "V4-29", "Signed update feed", ["src/desktopUpdater.cjs", "src/server/productionControlPlane.ts", "src/server/productionAcceptance.ts", "docs/technical/LIOS_V4_RELEASE_READINESS.md"], ["Update-feed metadata/endpoint verification is implemented; hosted signed artifacts and two-version update evidence remain external."], "Publish the signed feed, run the P3 distribution verifier, and complete the P2 update/rollback exercise."),
  ready("LV4-29-05", "V4-29", "Stable/beta channel policy", ["docs/technical/LIOS_V4_RELEASE_READINESS.md", "src/shared/v4OperationalContracts.ts"]),
  partial("LV4-29-06", "V4-29", "Website download integration", ["src/server/productionControlPlane.ts", "src/server/productionControlRoutes.ts", "src/server/productionAcceptance.ts", "docs/technical/LIOS_V4_RELEASE_READINESS.md"], ["Sanitized public distribution metadata and active endpoint verification are implemented; the real website/download hosts remain external."], "Configure the public website and signed artifact URLs, then run the distribution verifier."),
  ready("LV4-29-08", "V4-29", "Onboarding/help documentation", ["docs/technical/LIOS_V4_SUPPORT_RUNBOOK.md", "docs/technical/LIOS_V4_RELEASE_READINESS.md"]),
  ready("LV4-29-09", "V4-29", "Privacy/security/support docs", ["docs/technical/LIOS_V4_SECURITY_READINESS.md", "docs/technical/LIOS_V4_SUPPORT_RUNBOOK.md"]),
  partial("LV4-29-10", "V4-29", "Release notes/changelog", [], ["No release-specific changelog or release notes are tracked in the repository."], "Prepare release notes from the exact release commit and attach them to the release record."),
  ready("LV4-29-11", "V4-29", "Rollback plan", ["docs/technical/LIOS_V4_RELEASE_READINESS.md", "docs/technical/LIOS_V4_P3_RUNBOOK.md", "src/server/backupArchive.ts", "src/desktopUpdater.cjs"]),
  partial("LV4-29-12", "V4-29", "Public V4 release sign-off", ["docs/technical/LIOS_V4_RELEASE_READINESS.md", "src/shared/v4OperationalContracts.ts"], ["Public release requires signed artifacts, live provider evidence, and release-owner approval."], "Complete external release gates and record the final sign-off.")
]);

function boolEnv(env: Record<string, string | undefined>, ...keys: string[]): boolean {
  return keys.some((key) => Boolean(env[key]?.trim()));
}

function allEnv(env: Record<string, string | undefined>, ...keys: string[]): boolean {
  return keys.every((key) => Boolean(env[key]?.trim()));
}

export function getV4EnvironmentReadiness(env: Record<string, string | undefined> = process.env): V4EnvironmentReadiness {
  const channel = env.LIOS_RELEASE_CHANNEL?.trim().toLowerCase();
  return {
    databaseConfigured: boolEnv(env, "DATABASE_URL", "LIOS_DATA_ROOT", "LIMURIA_DATA_DIR"),
    hostedVaultConfigured: boolEnv(env, "LIMURIA_HOSTED_VAULT_SECRET"),
    updateFeedConfigured: boolEnv(env, "LIOS_UPDATE_URL"),
    releaseChannel: channel === "stable" || channel === "beta" ? channel : "unset",
    macSigningConfigured: boolEnv(env, "APPLE_TEAM_ID", "CSC_LINK", "APPLE_ID"),
    windowsSigningConfigured: boolEnv(env, "WIN_CSC_LINK", "CSC_LINK"),
    websiteDownloadConfigured: allEnv(env, "LIOS_PUBLIC_APP_URL", "LIOS_DOWNLOAD_MAC_URL", "LIOS_DOWNLOAD_WINDOWS_URL"),
  };
}

function phaseSummary(phase: OperationalPhase, items: readonly V4OperationalItem[]): V4OperationalPhaseSummary {
  const scoped = items.filter((item) => item.phase === phase);
  return {
    phase,
    status: scoped.some((item) => item.status === "blocked") ? "blocked" : scoped.some((item) => item.status === "partial") ? "partial" : "ready",
    ready: scoped.filter((item) => item.status === "ready").length,
    partial: scoped.filter((item) => item.status === "partial").length,
    blocked: scoped.filter((item) => item.status === "blocked").length,
    total: scoped.length,
  };
}

export function buildV4OperationalReadiness(now = new Date(), items: readonly V4OperationalItem[] = V4_OPERATIONAL_ITEMS, env: Record<string, string | undefined> = process.env): V4OperationalReadiness {
  const phases = (["V4-25", "V4-26", "V4-27", "V4-28", "V4-29"] as const).map((phase) => phaseSummary(phase, items));
  const blockers = [...new Set(items.flatMap((item) => item.blockers))];
  const evidence = [...new Set(items.flatMap((item) => item.evidence))];
  return {
    contractVersion: V4_OPERATIONAL_CONTRACT_VERSION,
    generatedAt: now.toISOString(),
    status: items.some((item) => item.status === "blocked") ? "blocked" : items.some((item) => item.status === "partial") ? "partial" : "ready",
    items: [...items],
    phases,
    environment: getV4EnvironmentReadiness(env),
    blockers,
    evidence,
  };
}

export function findV4OperationalItem(id: string, items: readonly V4OperationalItem[] = V4_OPERATIONAL_ITEMS): V4OperationalItem | null {
  return items.find((item) => item.id === id) ?? null;
}
