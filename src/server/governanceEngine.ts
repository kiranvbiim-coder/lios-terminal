/**
 * Governance Engine: support mode consent, diagnostic redaction,
 * and compliance review utilities. These enforce the product rule
 * that Limuria controls access, not client data.
 *
 * Support mode:
 * - Requires explicit user consent with time window.
 * - Shows app status, connector health, config state, error logs.
 * - NEVER exposes raw credentials, client data, or private keys.
 * - All support actions are audit-logged.
 *
 * Diagnostic export:
 * - Produces a redacted diagnostic bundle safe to share with support.
 * - Strips secrets, client data, personal info from logs and config.
 */

// ─── Support Mode Consent ─────────────────────────────────────────────────

export interface SupportConsentRequest {
  userId: number;
  organizationId?: number;
  consentDurationMinutes: number;
  reason: string;
  supportAgentId?: string;
}

export interface SupportConsent {
  id: string;
  userId: number;
  organizationId?: number;
  grantedAt: string;
  expiresAt: string;
  reason: string;
  supportAgentId?: string;
  revoked: boolean;
  revokedAt?: string;
}

export interface SupportConsentDecision {
  allowed: boolean;
  reason: "consent_active" | "consent_expired" | "consent_revoked" | "no_consent";
  consent?: SupportConsent;
}

let activeConsents: SupportConsent[] = [];

export function grantSupportConsent(request: SupportConsentRequest): SupportConsent {
  if (request.consentDurationMinutes <= 0 || request.consentDurationMinutes > 480) {
    throw new Error("Support consent duration must be between 1 and 480 minutes.");
  }

  const now = new Date();
  const consent: SupportConsent = {
    id: `sc_${Date.now()}_${request.userId}`,
    userId: request.userId,
    organizationId: request.organizationId,
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + request.consentDurationMinutes * 60_000).toISOString(),
    reason: request.reason,
    supportAgentId: request.supportAgentId,
    revoked: false,
  };

  activeConsents.push(consent);
  return consent;
}

export function revokeSupportConsent(consentId: string): boolean {
  const consent = activeConsents.find((c) => c.id === consentId && !c.revoked);
  if (!consent) return false;
  consent.revoked = true;
  consent.revokedAt = new Date().toISOString();
  return true;
}

export function evaluateSupportAccess(userId: number, now = new Date()): SupportConsentDecision {
  // Find the most recent consent for this user (revoked or not)
  const consents = activeConsents.filter((c) => c.userId === userId);
  const consent = consents.at(-1); // latest
  if (!consent) return { allowed: false, reason: "no_consent" };
  if (consent.revoked) return { allowed: false, reason: "consent_revoked", consent };
  if (new Date(consent.expiresAt).getTime() < now.getTime()) return { allowed: false, reason: "consent_expired", consent };
  return { allowed: true, reason: "consent_active", consent };
}

export function clearAllConsents(): void {
  activeConsents = [];
}

// ─── Diagnostic Redaction ─────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /private[_-]?key/i,
  /auth/i,
  /bearer/i,
  /session[_-]?id/i,
  /cookie/i,
];

const PII_PATTERNS = [
  /email/i,
  /phone/i,
  /address/i,
  /ssn/i,
  /social[_-]?security/i,
  /date[_-]?of[_-]?birth/i,
  /passport[_-]?number/i,
];

export interface RedactionResult {
  redactedData: Record<string, unknown>;
  redactedFields: string[];
  redactedCount: number;
}

/**
 * Redact sensitive fields from a diagnostic object.
 * Returns a deep copy with secrets and PII replaced by "[REDACTED]".
 */
export function redactDiagnostics(data: Record<string, unknown>, additionalPatterns: RegExp[] = []): RedactionResult {
  const allPatterns = [...SECRET_PATTERNS, ...PII_PATTERNS, ...additionalPatterns];
  const redactedFields: string[] = [];

  function redactValue(key: string, value: unknown, path: string): unknown {
    const fullPath = path ? `${path}.${key}` : key;

    // Check if key matches any sensitive pattern
    if (allPatterns.some((p) => p.test(key))) {
      redactedFields.push(fullPath);
      return "[REDACTED]";
    }

    // Check if string value looks like a secret (long hex/base64)
    if (typeof value === "string" && value.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(value)) {
      redactedFields.push(fullPath);
      return "[REDACTED]";
    }

    // Recurse into objects
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const redacted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        redacted[k] = redactValue(k, v, fullPath);
      }
      return redacted;
    }

    // Recurse into arrays
    if (Array.isArray(value)) {
      return value.map((item, i) => {
        if (item && typeof item === "object") return redactValue(String(i), item, fullPath);
        return item;
      });
    }

    return value;
  }

  const redactedData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    redactedData[key] = redactValue(key, value, "");
  }

  return { redactedData, redactedFields, redactedCount: redactedFields.length };
}

// ─── Diagnostic Bundle ────────────────────────────────────────────────────

export interface DiagnosticBundle {
  generatedAt: string;
  consentId: string;
  systemInfo: {
    platform: string;
    nodeVersion: string;
    uptime: number;
  };
  connectorHealth: unknown;
  configState: Record<string, unknown>;
  recentErrors: string[];
  redactedFields: string[];
}

export function generateDiagnosticBundle(
  consentId: string,
  connectorHealth: unknown,
  configState: Record<string, unknown>,
  recentErrors: string[],
): DiagnosticBundle {
  const redacted = redactDiagnostics(configState);

  return {
    generatedAt: new Date().toISOString(),
    consentId,
    systemInfo: {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: process.uptime(),
    },
    connectorHealth,
    configState: redacted.redactedData,
    recentErrors: recentErrors.map((err) => {
      // Redact any secrets that might appear in error messages
      let cleaned = err;
      for (const pattern of SECRET_PATTERNS) {
        cleaned = cleaned.replace(new RegExp(`(${pattern.source})[=:][^\\s,}]+`, "gi"), "$1=[REDACTED]");
      }
      return cleaned;
    }),
    redactedFields: redacted.redactedFields,
  };
}

// ─── Permission Matrix ────────────────────────────────────────────────────

export type PermissionAction =
  | "view_dashboard"
  | "manage_users"
  | "manage_organizations"
  | "manage_licenses"
  | "manage_devices"
  | "manage_sessions"
  | "manage_entitlements"
  | "manage_credentials"
  | "grant_support_access"
  | "export_diagnostics"
  | "view_audit_log"
  | "run_engines"
  | "export_reports"
  | "manage_workspaces";

export type RoleType = "internal_admin" | "internal_analyst" | "internal_compliance" | "client_admin" | "client_user";

const PERMISSION_MATRIX: Record<RoleType, Set<PermissionAction>> = {
  internal_admin: new Set<PermissionAction>([
    "view_dashboard", "manage_users", "manage_organizations", "manage_licenses",
    "manage_devices", "manage_sessions", "manage_entitlements", "manage_credentials",
    "grant_support_access", "export_diagnostics", "view_audit_log",
    "run_engines", "export_reports", "manage_workspaces",
  ]),
  internal_analyst: new Set<PermissionAction>([
    "view_dashboard", "view_audit_log", "run_engines", "export_reports", "manage_workspaces",
  ]),
  internal_compliance: new Set<PermissionAction>([
    "view_dashboard", "view_audit_log", "export_reports",
  ]),
  client_admin: new Set<PermissionAction>([
    "view_dashboard", "view_audit_log", "export_reports",
  ]),
  client_user: new Set<PermissionAction>([
    "view_dashboard", "export_reports",
  ]),
};

export function hasPermission(role: RoleType, action: PermissionAction): boolean {
  return PERMISSION_MATRIX[role]?.has(action) ?? false;
}

export function getPermissionsForRole(role: RoleType): PermissionAction[] {
  return Array.from(PERMISSION_MATRIX[role] ?? []);
}
