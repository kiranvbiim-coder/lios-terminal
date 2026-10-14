import { isEmailConfigured } from "./emailService";
import {
  buildPublicDistributionManifest,
  ensureProductionRetentionPolicy,
  latestDeletionReceipt,
  latestDiagnosticEvidence,
  latestDistributionEvidence,
  latestExportCustodyReceipt,
  latestOperationsNotificationEvidence,
} from "./productionControlPlane";

export type ProductionAcceptanceCategory =
  | "distribution"
  | "retention"
  | "custody"
  | "diagnostics"
  | "notifications"
  | "runbook";

export type ProductionAcceptanceState = "verified" | "degraded" | "blocked";

export interface ProductionAcceptanceRow {
  id: string;
  label: string;
  category: ProductionAcceptanceCategory;
  state: ProductionAcceptanceState;
  evidenceAt: string | null;
  evidence: string[];
  blockers: string[];
  nextAction: string;
}

export interface ProductionAcceptanceSnapshot {
  contractVersion: "1.0.0";
  generatedAt: string;
  status: "ready" | "partial";
  counts: { verified: number; degraded: number; blocked: number; total: number };
  rows: ProductionAcceptanceRow[];
  externalBlockers: string[];
}

function verified(
  id: string,
  label: string,
  category: ProductionAcceptanceCategory,
  evidence: string[],
  nextAction: string,
  evidenceAt: string | null = null,
): ProductionAcceptanceRow {
  return { id, label, category, state: "verified", evidenceAt, evidence, blockers: [], nextAction };
}

function blocked(
  id: string,
  label: string,
  category: ProductionAcceptanceCategory,
  evidence: string[],
  blockers: string[],
  nextAction: string,
  evidenceAt: string | null = null,
): ProductionAcceptanceRow {
  return { id, label, category, state: "blocked", evidenceAt, evidence, blockers, nextAction };
}

export async function buildProductionAcceptanceSnapshot(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProductionAcceptanceSnapshot> {
  const [
    retention,
    distributionEvidence,
    retentionPurgeEvidence,
    deletionEvidence,
    exportEvidence,
    performanceEvidence,
    crashEvidence,
    notificationEvidence,
  ] = await Promise.all([
    ensureProductionRetentionPolicy(),
    latestDistributionEvidence(),
    latestDeletionReceipt("retention_expiry"),
    latestDeletionReceipt("operational_diagnostics"),
    latestExportCustodyReceipt(),
    latestDiagnosticEvidence("performance"),
    latestDiagnosticEvidence("crash"),
    latestOperationsNotificationEvidence(),
  ]);

  const distribution = buildPublicDistributionManifest(env);
  const operationsEmail = env.LIOS_OPERATIONS_ALERT_EMAIL?.trim() || null;

  const rows: ProductionAcceptanceRow[] = [
    verified(
      "production:distribution-contract",
      "Public desktop distribution contract",
      "distribution",
      [
        "The control plane exposes sanitized website/download/update metadata at /api/public/desktop-distribution.",
        "Admin verification probes website, signed downloads and both update metadata files and persists a dated success event.",
      ],
      "Configure production HTTPS URLs and run the active distribution verification after publishing signed artifacts.",
    ),
    distribution.ready && distributionEvidence
      ? verified(
          "production:distribution-live",
          "Public website/download/update distribution",
          "distribution",
          ["All required public distribution URLs are configured and a live endpoint probe succeeded."],
          "Repeat after every public release/update-feed change.",
          distributionEvidence.createdAt.toISOString(),
        )
      : blocked(
          "production:distribution-live",
          "Public website/download/update distribution",
          "distribution",
          ["Distribution URLs are validated as customer-reachable HTTPS and update metadata is probed explicitly."],
          [
            ...distribution.blockers,
            ...(!distributionEvidence ? ["No dated successful distribution endpoint verification is recorded."] : []),
          ],
          "Publish the signed artifacts/update metadata, configure the public URLs, then run /api/admin/production-control/distribution/verify.",
          distributionEvidence?.createdAt.toISOString() ?? null,
        ),

    verified(
      "production:retention-policy",
      "Retention policy persistence",
      "retention",
      [
        `Current defaults/policy: telemetry ${retention.telemetryDays}d, deletion receipts ${retention.deletionReceiptDays}d, export receipts ${retention.exportReceiptDays}d.`,
        "Admin updates are bounded and audited.",
      ],
      "Review the policy with legal/security before public release and retain the approved values.",
    ),
    verified(
      "production:retention-worker-contract",
      "Automated retention purge worker",
      "retention",
      ["Hosted production starts a daily purge; customer desktops never run it because they have no hosted DATABASE_URL."],
      "Confirm the worker executes in production and retain a purge receipt.",
    ),
    retentionPurgeEvidence
      ? verified(
          "production:retention-worker-live",
          "Production retention purge evidence",
          "retention",
          ["A retention-expiry purge completed and generated a durable deletion receipt."],
          "Monitor daily execution and investigate missed runs.",
          retentionPurgeEvidence.completedAt?.toISOString() ?? retentionPurgeEvidence.requestedAt.toISOString(),
        )
      : blocked(
          "production:retention-worker-live",
          "Production retention purge evidence",
          "retention",
          ["The purge worker and manual confirmed purge route are implemented."],
          ["No production retention-expiry deletion receipt is recorded yet."],
          "Run/deploy the hosted worker or explicitly execute the confirmed purge and retain its receipt.",
        ),

    verified(
      "production:deletion-receipt-contract",
      "Deletion receipt and operational purge contract",
      "retention",
      [
        "Operational diagnostics metadata can be purged per organization with explicit confirmation and an auditable receipt.",
        "Receipts contain counts/reason/status, not deleted payload contents.",
      ],
      "Exercise one approved non-production organization purge before public release.",
    ),
    deletionEvidence
      ? verified(
          "production:deletion-live",
          "Organization operational deletion evidence",
          "retention",
          ["A confirmed organization diagnostics purge produced a durable deletion receipt."],
          "Retain the receipt according to the approved deletion-receipt policy.",
          deletionEvidence.completedAt?.toISOString() ?? deletionEvidence.requestedAt.toISOString(),
        )
      : blocked(
          "production:deletion-live",
          "Organization operational deletion evidence",
          "retention",
          ["The deletion flow is confirmation-gated and audited."],
          ["No dated organization operational-metadata deletion receipt exists."],
          "Run the purge against an approved test organization and retain the receipt.",
        ),

    verified(
      "production:export-custody-contract",
      "Local-only export custody receipts",
      "custody",
      [
        "Shared PDF/XLSX exporters hash generated bytes and readable filenames locally and register only hashes/size/format.",
        "The hosted control plane never receives exported report/workbook bytes through this flow.",
      ],
      "Exercise an export from a signed customer desktop and verify its receipt appears centrally.",
    ),
    exportEvidence
      ? verified(
          "production:export-custody-live",
          "Live export custody evidence",
          "custody",
          ["A customer export custody receipt has been registered without central file custody."],
          "Periodically sample receipts against local exported artifacts.",
          exportEvidence.registeredAt.toISOString(),
        )
      : blocked(
          "production:export-custody-live",
          "Live export custody evidence",
          "custody",
          ["PDF/XLSX shared exporters automatically attempt receipt registration after the local download is created."],
          ["No live export custody receipt is recorded."],
          "Generate an export from a connected customer desktop and confirm receipt registration.",
        ),

    verified(
      "production:diagnostics-contract",
      "Redacted diagnostics and crash sink",
      "diagnostics",
      [
        "Remote diagnostics are disabled unless LIOS_TELEMETRY_ENABLED=true.",
        "Only allow-listed counters/codes plus SHA-256 crash fingerprints are accepted; raw stacks, prompts, notes, commands, files and client data are excluded.",
      ],
      "Enable diagnostics in the production control plane only after retention/privacy review.",
    ),
    performanceEvidence
      ? verified(
          "production:diagnostics-live",
          "Live aggregate terminal diagnostics",
          "diagnostics",
          ["An authenticated customer terminal has submitted a redacted aggregate performance event."],
          "Monitor volume/retention and keep the accepted detail-key allow-list narrow.",
          performanceEvidence.createdAt.toISOString(),
        )
      : blocked(
          "production:diagnostics-live",
          "Live aggregate terminal diagnostics",
          "diagnostics",
          ["The customer terminal polls diagnostics configuration and flushes aggregate counters only when enabled."],
          [env.LIOS_TELEMETRY_ENABLED?.trim().toLowerCase() === "true" ? "No live aggregate diagnostic event is recorded." : "LIOS_TELEMETRY_ENABLED is not true."],
          "Enable the reviewed production sink and exercise a connected customer terminal.",
        ),
    crashEvidence
      ? verified(
          "production:crash-live",
          "Live crash fingerprint evidence",
          "diagnostics",
          ["A crash/server-error fingerprint was retained without raw stack content."],
          "Confirm fingerprints group incidents without exposing user content.",
          crashEvidence.createdAt.toISOString(),
        )
      : blocked(
          "production:crash-live",
          "Live crash fingerprint evidence",
          "diagnostics",
          ["React root crashes and hosted server 5xx errors are fingerprinted locally/server-side before storage."],
          ["No dated crash fingerprint event is recorded."],
          "Exercise the controlled crash-test path in a non-production account or wait for a real incident after diagnostics are enabled.",
        ),

    verified(
      "production:notification-contract",
      "Production operations notification path",
      "notifications",
      [
        "Operations notifications use the configured SMTP transport and a deployment-controlled destination; arbitrary admin-supplied recipients are not accepted by the test route.",
      ],
      "Configure the operations alert destination and execute the acceptance notification.",
    ),
    operationsEmail && isEmailConfigured() && notificationEvidence
      ? verified(
          "production:notification-live",
          "Live operations notification delivery",
          "notifications",
          ["A production operations notification was delivered through the configured SMTP path."],
          "Repeat after mail-provider/configuration changes.",
          notificationEvidence.createdAt.toISOString(),
        )
      : blocked(
          "production:notification-live",
          "Live operations notification delivery",
          "notifications",
          [],
          [
            ...(!operationsEmail ? ["LIOS_OPERATIONS_ALERT_EMAIL is not configured."] : []),
            ...(!isEmailConfigured() ? ["SMTP transport is not configured."] : []),
            ...(!notificationEvidence ? ["No dated successful operations-notification delivery is recorded."] : []),
          ],
          "Configure SMTP + LIOS_OPERATIONS_ALERT_EMAIL and run /api/admin/production-control/notification/test.",
          notificationEvidence?.createdAt.toISOString() ?? null,
        ),

    verified(
      "production:rollback-runbook",
      "Production services rollback/runbook contract",
      "runbook",
      [
        "P3 runbook documents distribution rollback, diagnostics disablement, retention recovery and notification fallback.",
      ],
      "Exercise the runbook during release-candidate operations acceptance.",
    ),
  ];

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
