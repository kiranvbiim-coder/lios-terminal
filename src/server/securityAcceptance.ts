import { secureSessionCookieRequired, trustProxySetting } from "./runtimeSecurity";
import { buildDesktopAcceptanceSnapshot } from "./desktopAcceptance";
import { buildProductionAcceptanceSnapshot } from "./productionAcceptance";

export type SecurityAcceptanceCategory =
  | "desktop"
  | "network"
  | "session"
  | "tenant"
  | "uploads"
  | "secrets"
  | "privacy"
  | "supply_chain"
  | "external_review";

export type SecurityAcceptanceState = "verified" | "blocked";

export interface SecurityAcceptanceRow {
  id: string;
  label: string;
  category: SecurityAcceptanceCategory;
  state: SecurityAcceptanceState;
  evidenceAt: string | null;
  evidence: string[];
  blockers: string[];
  nextAction: string;
}

export interface SecurityAcceptanceSnapshot {
  contractVersion: "1.0.0";
  generatedAt: string;
  status: "ready" | "partial";
  counts: { verified: number; blocked: number; total: number };
  rows: SecurityAcceptanceRow[];
  externalBlockers: string[];
}

function verified(
  id: string,
  label: string,
  category: SecurityAcceptanceCategory,
  evidence: string[],
  nextAction: string,
): SecurityAcceptanceRow {
  return { id, label, category, state: "verified", evidenceAt: null, evidence, blockers: [], nextAction };
}

function blocked(
  id: string,
  label: string,
  category: SecurityAcceptanceCategory,
  evidence: string[],
  blockers: string[],
  nextAction: string,
): SecurityAcceptanceRow {
  return { id, label, category, state: "blocked", evidenceAt: null, evidence, blockers, nextAction };
}

export async function buildSecurityAcceptanceSnapshot(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecurityAcceptanceSnapshot> {
  const desktop = buildDesktopAcceptanceSnapshot(now, env);
  const production = await buildProductionAcceptanceSnapshot(now, env);
  const nativeSecret = desktop.rows.find((row) => row.id === "desktop:native-secret-custody");
  const deletionLive = production.rows.find((row) => row.id === "production:deletion-live");
  const exportLive = production.rows.find((row) => row.id === "production:export-custody-live");

  const rows: SecurityAcceptanceRow[] = [
    verified(
      "security:desktop-ipc",
      "Electron renderer/main privilege boundary",
      "desktop",
      [
        "Renderer runs with nodeIntegration disabled, context isolation and sandboxing enabled.",
        "Privileged IPC handlers authenticate the active top-level LiOS renderer and reject foreign origins, subframes and unrelated webContents.",
        "External navigation and child-window creation are denied by default.",
      ],
      "Keep desktopIpcSecurity tests in the permanent desktop qualification gate.",
    ),
    verified(
      "security:connector-ssrf",
      "Hosted connector SSRF and redirect boundary",
      "network",
      [
        "Hosted REST/GraphQL/SOAP connectors require HTTP(S), reject URL-embedded credentials, and require HTTPS in hosted production.",
        "Private, loopback, link-local, reserved and multicast targets are denied after DNS resolution unless an explicit deployment-owned private-network exception is enabled.",
        "Every redirect is revalidated and credentials are never forwarded to a different origin.",
      ],
      "Keep private-network exceptions deployment-owned and document any approved private integration before enabling it.",
    ),
    verified(
      "security:hosted-session",
      "Hosted session and proxy trust boundary",
      "session",
      [
        `Hosted secure-cookie requirement: ${secureSessionCookieRequired(env) ? "enabled" : "not active in this process"}.`,
        `Configured trust-proxy policy: ${String(trustProxySetting(env))}.`,
        "Authentication rotates sessions, cookie auth is CSRF-protected, and production device bindings ignore client-controlled legacy fingerprints.",
      ],
      "Set TRUST_PROXY to the exact trusted proxy-hop count when the deployment topology differs from the one-hop default.",
    ),
    verified(
      "security:tenant-isolation",
      "Tenant authorization and database isolation contract",
      "tenant",
      [
        "Client/internal audience gates, organization ownership checks and hosted tenant context are server-side.",
        "The authoritative Quality Gate executes live PostgreSQL RLS attack-plan tests; P5 does not replace them with an in-memory substitute.",
      ],
      "Keep live RLS attack-plan tests mandatory for every tenant-sensitive change.",
    ),
    verified(
      "security:local-byod-boundary",
      "Local-first customer BYOD execution boundary",
      "privacy",
      [
        "Hosted production rejects raw client dataset ingestion before Multer reads the request body.",
        "User-configured private API, cloud-storage and PostgreSQL/MySQL/SQLite/DuckDB BYOD connectors fail closed on the hosted control plane and remain available to the local desktop runtime.",
        "The hosted control plane retains commercial/enterprise authority without becoming a customer database or raw-file proxy.",
      ],
      "Keep customer raw-file and database execution local unless a future reviewed architecture explicitly changes the custody model.",
    ),
    verified(
      "security:upload-validation",
      "Untrusted BYOD upload boundary",
      "uploads",
      [
        "Upload count and byte limits are enforced before parsing.",
        "Client BYOD and internal UIDE flows validate content signatures instead of trusting filename extensions.",
        "Uploaded filenames are normalized before parsing, persistence and audit use.",
      ],
      "Add format-specific bomb/complexity limits if future parsers accept compressed archives beyond supported spreadsheet containers.",
    ),
    verified(
      "security:secret-redaction",
      "Secret custody and diagnostic redaction contract",
      "secrets",
      [
        "Organization credentials remain in encrypted vault custody and list/readiness APIs do not return secret values.",
        "Hosted 5xx logging records a fingerprint and error class rather than serializing the raw error object.",
        "Support/diagnostic payloads use the shared redaction and allow-list contracts.",
      ],
      "Keep new logs, telemetry fields and support bundles inside the same redaction boundary.",
    ),
    nativeSecret?.state === "verified"
      ? verified(
          "security:native-secret-custody",
          "Signed-platform native secret custody evidence",
          "secrets",
          nativeSecret.evidence,
          "Repeat packaged native secret-custody self-tests after signing/runtime changes.",
        )
      : blocked(
          "security:native-secret-custody",
          "Signed-platform native secret custody evidence",
          "secrets",
          ["Electron safeStorage binding, protected key persistence and packaged round-trip self-test are implemented."],
          ["Real signed macOS and Windows package evidence remains target-platform release evidence."],
          "Run the packaged desktop self-test on the signed/notarized macOS build and signed Windows installer candidate.",
        ),
    verified(
      "security:privacy-lifecycle",
      "Retention, deletion, export custody and legal-hold contract",
      "privacy",
      [
        "Hosted retention workers, deletion receipts, local-only export custody metadata and enterprise legal-hold enforcement are implemented.",
        "Telemetry is opt-in and bounded to redacted/allow-listed diagnostics.",
      ],
      "Keep legal-hold and deletion regression tests coupled to retention changes.",
    ),
    deletionLive?.state === "verified" && exportLive?.state === "verified"
      ? verified(
          "security:privacy-live-evidence",
          "Production privacy lifecycle evidence",
          "privacy",
          [...deletionLive.evidence, ...exportLive.evidence],
          "Retain dated deletion/export evidence according to the approved production policy.",
        )
      : blocked(
          "security:privacy-live-evidence",
          "Production privacy lifecycle evidence",
          "privacy",
          ["Repository controls are implemented and regression-tested."],
          [
            ...(deletionLive?.state === "verified" ? [] : ["No dated production organization-deletion receipt is recorded."]),
            ...(exportLive?.state === "verified" ? [] : ["No dated connected-customer export-custody receipt is recorded."]),
          ],
          "Exercise approved production/test-tenant deletion and a connected customer export, then retain their receipts.",
        ),
    verified(
      "security:dependency-ci",
      "Production dependency audit gate",
      "supply_chain",
      [
        "The authoritative LIOS Quality Gate runs npm run audit:prod before typecheck/tests/build; it prefers npm audit --omit=dev --audit-level=high and fails closed through npm's official Bulk Advisory endpoint when the retiring quick-audit fallback cannot return a valid report.",
        "Release work must fix or explicitly block on high/critical production dependency findings rather than suppressing the gate.",
      ],
      "Keep the production dependency audit green and review vendored/runtime dependencies during release-candidate qualification.",
    ),
    blocked(
      "security:independent-security-scan",
      "Independent dependency/application security scan",
      "supply_chain",
      ["Repository-side audit and hardening evidence is ready for an independent reviewer."],
      ["No independent third-party scan/remediation attestation can be manufactured from repository tests."],
      "Run an approved independent dependency/application scan against the release candidate and retain the report/remediation disposition.",
    ),
    blocked(
      "security:independent-review",
      "Independent security review / penetration test",
      "external_review",
      ["P5 runbook, threat model, test matrix and machine-readable acceptance ledger form the review pack."],
      ["Independent review remains an external release-owner/security activity."],
      "Complete an independent security review or penetration test before public production sign-off and disposition every material finding.",
    ),
  ];

  const counts = {
    verified: rows.filter((row) => row.state === "verified").length,
    blocked: rows.filter((row) => row.state === "blocked").length,
    total: rows.length,
  };
  return {
    contractVersion: "1.0.0",
    generatedAt: now.toISOString(),
    status: counts.blocked ? "partial" : "ready",
    counts,
    rows,
    externalBlockers: [...new Set(rows.flatMap((row) => row.blockers))],
  };
}
