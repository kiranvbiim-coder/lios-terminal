import { AI_PROVIDERS, getAvailableProviders } from "./byoaiRouter";
import { getConnectorRegistrySnapshot } from "./connectorService";
import { getConnectorVerification } from "./connectorVerification";
import { isEmailConfigured } from "./emailService";

export type ProviderAcceptanceCategory = "ai" | "data" | "sidecar" | "news" | "communications";
export type ProviderAcceptanceState = "verified" | "degraded" | "blocked";

export interface ProviderAcceptanceRow {
  id: string;
  label: string;
  category: ProviderAcceptanceCategory;
  state: ProviderAcceptanceState;
  configured: boolean;
  liveVerified: boolean;
  evidenceAt: string | null;
  evidence: string[];
  blockers: string[];
  nextAction: string;
}

export interface ProviderAcceptanceSnapshot {
  contractVersion: "1.0.0";
  generatedAt: string;
  status: "ready" | "partial";
  counts: { verified: number; degraded: number; blocked: number; total: number };
  rows: ProviderAcceptanceRow[];
  externalBlockers: string[];
}

function row(input: Omit<ProviderAcceptanceRow, "liveVerified"> & { liveVerified?: boolean }): ProviderAcceptanceRow {
  return { ...input, liveVerified: input.liveVerified ?? input.state === "verified" };
}

function connectorAcceptance(
  connector: { id: string; name: string; sourceType: string; setupGuide: string; adapterImplemented: boolean },
  health: { state: string; detail: string; lastVerifiedAt?: string | null },
): ProviderAcceptanceRow {
  const category: ProviderAcceptanceCategory = connector.sourceType === "sidecar" ? "sidecar" : "data";
  if (health.state === "live_verified") {
    return row({
      id: `connector:${connector.id}`,
      label: connector.name,
      category,
      state: "verified",
      configured: true,
      evidenceAt: health.lastVerifiedAt ?? null,
      evidence: [health.detail],
      blockers: [],
      nextAction: "Keep the provider exercised in the target deployment and preserve attribution/entitlement evidence.",
    });
  }
  if (health.state === "degraded" || health.state === "rate_limited") {
    return row({
      id: `connector:${connector.id}`,
      label: connector.name,
      category,
      state: "degraded",
      configured: true,
      liveVerified: false,
      evidenceAt: null,
      evidence: [health.detail],
      blockers: [health.state === "rate_limited" ? "Provider rate limit is currently blocking acceptance." : "The latest live provider check failed."],
      nextAction: connector.setupGuide,
    });
  }

  const blocker =
    !connector.adapterImplemented || health.state === "catalog_only"
      ? "Adapter is catalogued but not implemented in this build."
      : health.state === "disabled"
        ? "Provider/sidecar is explicitly disabled."
        : health.state === "credential_configured"
          ? "Credential/configuration is present, but no live endpoint call has succeeded in this process."
          : connector.sourceType === "keyed_api"
            ? "Approved provider credential is not configured."
            : "A live endpoint call has not yet produced dated evidence.";

  return row({
    id: `connector:${connector.id}`,
    label: connector.name,
    category,
    state: "blocked",
    configured: ["credential_configured", "disabled"].includes(health.state),
    liveVerified: false,
    evidenceAt: null,
    evidence: [health.detail],
    blockers: [blocker],
    nextAction: connector.setupGuide,
  });
}

function aiAcceptance(): ProviderAcceptanceRow[] {
  const availability = new Map(getAvailableProviders().map((provider) => [provider.id, provider]));
  return AI_PROVIDERS.map((provider) => {
    const configured = availability.get(provider.id)?.available === true;
    const verification = getConnectorVerification(provider.id);
    if (verification?.ok && configured) {
      return row({
        id: `ai:${provider.id}`,
        label: provider.name,
        category: "ai",
        state: "verified",
        configured: true,
        evidenceAt: verification.at,
        evidence: [verification.detail, `Model policy: ${provider.allowCustomModel ? "curated + approved custom IDs" : "curated model allow-list"}.`],
        blockers: [],
        nextAction: "Keep model policy and attribution evidence with each accepted live call.",
      });
    }
    if (verification && !verification.ok && configured) {
      return row({
        id: `ai:${provider.id}`,
        label: provider.name,
        category: "ai",
        state: "degraded",
        configured,
        liveVerified: false,
        evidenceAt: verification.at,
        evidence: [verification.detail],
        blockers: ["The latest governed live completion failed."],
        nextAction: "Correct the provider endpoint/model/credential and run one governed completion again.",
      });
    }
    return row({
      id: `ai:${provider.id}`,
      label: provider.name,
      category: "ai",
      state: "blocked",
      configured,
      liveVerified: false,
      evidenceAt: null,
      evidence: [`Default model: ${provider.defaultModel}.`],
      blockers: [configured
        ? "Provider is configured, but no governed live completion has succeeded in this process."
        : "Approved provider credential/endpoint configuration is missing."],
      nextAction: configured
        ? "Run one low-cost governed completion through the BYOAI transport and retain its attribution."
        : `Configure ${provider.envKey}${provider.requiredEnvKeys?.length ? ` plus ${provider.requiredEnvKeys.join(", ")}` : ""} or the corresponding user vault entry.`,
    });
  });
}

function communicationAcceptance(env: NodeJS.ProcessEnv = process.env): ProviderAcceptanceRow[] {
  const smtpVerification = getConnectorVerification("communication:smtp");
  const webhookVerification = getConnectorVerification("communication:webhook");
  const smtpConfigured = isEmailConfigured();
  const webhookConfigured = Boolean(env.WAVE_D_WEBHOOK_ALLOWLIST?.trim());

  const verifiedTransport = (
    id: string,
    label: string,
    configured: boolean,
    verification: ReturnType<typeof getConnectorVerification>,
    setup: string,
  ): ProviderAcceptanceRow => {
    if (verification?.ok && configured) {
      return row({ id, label, category: "communications", state: "verified", configured: true, evidenceAt: verification.at, evidence: [verification.detail], blockers: [], nextAction: "Keep dated delivery evidence for release acceptance." });
    }
    if (verification && !verification.ok && configured) {
      return row({ id, label, category: "communications", state: "degraded", configured, liveVerified: false, evidenceAt: verification.at, evidence: [verification.detail], blockers: ["The latest confirmed delivery attempt failed."], nextAction: setup });
    }
    return row({
      id,
      label,
      category: "communications",
      state: "blocked",
      configured,
      liveVerified: false,
      evidenceAt: verification?.at ?? null,
      evidence: verification ? [verification.detail] : [],
      blockers: [configured ? "Transport is configured, but no confirmed live delivery has succeeded in this process." : setup],
      nextAction: setup,
    });
  };

  return [
    row({ id: "communications:gmail", label: "Gmail OAuth", category: "communications", state: "blocked", configured: false, liveVerified: false, evidenceAt: null, evidence: ["Least-privilege permission contract exists."], blockers: ["Gmail OAuth adapter/consent is not wired in this build."], nextAction: "Wire the approved Gmail OAuth adapter, request only approved scopes, then record one consented send/read acceptance run." }),
    row({ id: "communications:microsoft365", label: "Microsoft 365 / Graph", category: "communications", state: "blocked", configured: false, liveVerified: false, evidenceAt: null, evidence: ["Least-privilege permission contract exists."], blockers: ["Microsoft Graph OAuth adapter/tenant consent is not wired in this build."], nextAction: "Wire Graph OAuth, obtain approved tenant consent, and record send/read acceptance evidence." }),
    row({ id: "communications:imap", label: "IMAP", category: "communications", state: "blocked", configured: false, liveVerified: false, evidenceAt: null, evidence: ["Mailbox permission/data contracts exist."], blockers: ["IMAP read adapter and encrypted per-user credential custody are not implemented."], nextAction: "Implement the IMAP adapter with local/encrypted custody, then exercise a consented mailbox read." }),
    verifiedTransport("communications:smtp", "SMTP", smtpConfigured, smtpVerification, "Configure SMTP_URL or SMTP_HOST/SMTP_USER/SMTP_PASS and run one explicitly confirmed delivery."),
    row({ id: "communications:slack", label: "Slack", category: "communications", state: "blocked", configured: false, liveVerified: false, evidenceAt: null, evidence: ["Permissioned notification envelope exists."], blockers: ["Slack OAuth/workspace delivery adapter is not wired."], nextAction: "Wire Slack OAuth with approved workspace scopes and record one confirmed delivery." }),
    row({ id: "communications:teams", label: "Microsoft Teams", category: "communications", state: "blocked", configured: false, liveVerified: false, evidenceAt: null, evidence: ["Permissioned notification envelope exists."], blockers: ["Teams/Graph delivery adapter and tenant consent are not wired."], nextAction: "Wire Teams delivery through approved Graph scopes and record one confirmed delivery." }),
    verifiedTransport("communications:webhook", "Allow-listed HTTPS Webhook", webhookConfigured, webhookVerification, "Configure WAVE_D_WEBHOOK_ALLOWLIST and run one explicitly confirmed HTTPS delivery."),
  ];
}

function newsAcceptance(): ProviderAcceptanceRow {
  const verification = getConnectorVerification("news:google_rss");
  if (verification?.ok) {
    return row({ id: "news:google_rss", label: "Google News RSS", category: "news", state: "verified", configured: true, evidenceAt: verification.at, evidence: [verification.detail], blockers: [], nextAction: "Keep source attribution on every hydrated article and use licensed feeds where commercial terms require them." });
  }
  if (verification && !verification.ok) {
    return row({ id: "news:google_rss", label: "Google News RSS", category: "news", state: "degraded", configured: true, liveVerified: false, evidenceAt: verification.at, evidence: [verification.detail], blockers: ["The latest public RSS hydration failed."], nextAction: "Retry a bounded public RSS fetch; licensed news-feed acceptance remains a separate external gate." });
  }
  return row({ id: "news:google_rss", label: "Google News RSS", category: "news", state: "blocked", configured: true, liveVerified: false, evidenceAt: null, evidence: ["Bounded public RSS hydration code exists."], blockers: ["No dated live RSS hydration has succeeded in this process.", "Licensed commercial news-feed hydration remains provider/entitlement-gated."], nextAction: "Run one attributed Google News RSS hydration and separately record the approved licensed-feed blocker/evidence." });
}

export async function buildProviderAcceptanceSnapshot(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<ProviderAcceptanceSnapshot> {
  const registry = await getConnectorRegistrySnapshot();
  const dataRows = registry.connectors
    .filter((connector) => !["ai", "private_data"].includes(connector.category) && !["file", "database", "private_api", "cloud_storage", "local_model"].includes(connector.sourceType))
    .map((connector) => {
      const health = registry.health.find((entry) => entry.connectorId === connector.id);
      return connectorAcceptance(connector, health ?? { state: "catalog_only", detail: "No runtime health report exists." });
    });
  const rows = [
    ...aiAcceptance(),
    ...dataRows,
    newsAcceptance(),
    ...communicationAcceptance(env),
  ];
  const counts = {
    verified: rows.filter((item) => item.state === "verified").length,
    degraded: rows.filter((item) => item.state === "degraded").length,
    blocked: rows.filter((item) => item.state === "blocked").length,
    total: rows.length,
  };
  const externalBlockers = [...new Set(rows.flatMap((item) => item.blockers))];
  return {
    contractVersion: "1.0.0",
    generatedAt: now.toISOString(),
    status: counts.blocked || counts.degraded ? "partial" : "ready",
    counts,
    rows,
    externalBlockers,
  };
}
