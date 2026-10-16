/**
 * Private beta readiness validator. Converts operational checks into an
 * explicit pass/fail report so beta launch cannot be declared from a vague
 * checklist. This validates configuration and observed checks; it does not
 * fabricate live provider availability.
 */

export type BetaCheckId =
  | "fresh_install"
  | "authentication"
  | "license_device"
  | "provider_credentials"
  | "byod_source"
  | "contract_binding"
  | "dcf_receipt"
  | "portfolio_risk"
  | "fixed_income"
  | "derivatives"
  | "macro"
  | "research"
  | "exports"
  | "ai_off"
  | "byoai"
  | "admin_controls"
  | "diagnostics_redaction"
  | "no_secret_leak"
  | "tenant_isolation";

export interface BetaCheck {
  id: BetaCheckId;
  label: string;
  required: boolean;
  passed: boolean;
  detail: string;
}

export interface BetaReadinessReport {
  ready: boolean;
  requiredPassed: number;
  requiredTotal: number;
  optionalPassed: number;
  optionalTotal: number;
  checks: BetaCheck[];
  blockers: string[];
}

export const BETA_CHECK_CATALOG: Array<Pick<BetaCheck, "id" | "label" | "required">> = [
  { id: "fresh_install", label: "Fresh install", required: true },
  { id: "authentication", label: "Authentication", required: true },
  { id: "license_device", label: "License and device authorization", required: true },
  { id: "provider_credentials", label: "Provider credentials", required: true },
  { id: "byod_source", label: "BYOD source", required: true },
  { id: "contract_binding", label: "Contract binding and readiness", required: true },
  { id: "dcf_receipt", label: "DCF with decision receipt", required: true },
  { id: "portfolio_risk", label: "Portfolio and risk workflow", required: true },
  { id: "fixed_income", label: "Fixed income workflow", required: true },
  { id: "derivatives", label: "Derivatives workflow", required: true },
  { id: "macro", label: "Macro workflow", required: true },
  { id: "research", label: "Research workflow", required: true },
  { id: "exports", label: "Professional exports", required: true },
  { id: "ai_off", label: "AI-off workflow", required: true },
  { id: "byoai", label: "BYOAI workflow", required: false },
  { id: "admin_controls", label: "Admin controls", required: true },
  { id: "diagnostics_redaction", label: "Redacted diagnostics", required: true },
  { id: "no_secret_leak", label: "No secret leakage", required: true },
  { id: "tenant_isolation", label: "Tenant isolation", required: true },
];

/**
 * Beta readiness is a fail-closed projection of the *canonical* check catalog.
 * A partial, duplicated, or caller-reclassified check list cannot declare a
 * product ready, even when every supplied check says it passed. This does not
 * itself attest real installed-target or release evidence.
 */
export function evaluateBetaReadiness(checks: BetaCheck[]): BetaReadinessReport {
  const catalogIds = new Set<BetaCheckId>(BETA_CHECK_CATALOG.map((check) => check.id));
  const supplied = new Map<BetaCheckId, BetaCheck>();
  const duplicates = new Set<BetaCheckId>();
  const integrityBlockers: string[] = [];

  for (const check of checks) {
    if (!catalogIds.has(check.id)) {
      integrityBlockers.push(`Unrecognized readiness check: ${check.id}`);
      continue;
    }
    if (supplied.has(check.id)) {
      duplicates.add(check.id);
      continue;
    }
    supplied.set(check.id, check);
  }
  for (const id of duplicates) {
    integrityBlockers.push(`Duplicate readiness check: ${id}`);
  }

  const normalized: BetaCheck[] = BETA_CHECK_CATALOG.map((catalog) => {
    const provided = supplied.get(catalog.id);
    const declarationValid = Boolean(
      provided
      && !duplicates.has(catalog.id)
      && provided.label === catalog.label
      && provided.required === catalog.required
    );
    if (provided && !duplicates.has(catalog.id) && !declarationValid) {
      integrityBlockers.push(`Altered readiness check declaration: ${catalog.id}`);
    }
    return {
      ...catalog,
      passed: declarationValid && provided?.passed === true,
      detail: !provided
        ? "Check has not been executed."
        : !declarationValid
          ? "Invalid or duplicated readiness check declaration."
          : provided.detail,
    };
  });
  const required = normalized.filter((check) => check.required);
  const optional = normalized.filter((check) => !check.required);
  const blockers = [
    ...required.filter((check) => !check.passed).map((check) => `${check.label}: ${check.detail}`),
    ...integrityBlockers,
  ];

  return {
    ready: blockers.length === 0,
    requiredPassed: required.filter((check) => check.passed).length,
    requiredTotal: required.length,
    optionalPassed: optional.filter((check) => check.passed).length,
    optionalTotal: optional.length,
    checks: normalized,
    blockers,
  };
}

export function buildBetaChecks(results: Partial<Record<BetaCheckId, { passed: boolean; detail: string }>>): BetaCheck[] {
  return BETA_CHECK_CATALOG.map((catalog) => ({
    ...catalog,
    passed: results[catalog.id]?.passed ?? false,
    detail: results[catalog.id]?.detail ?? "Check has not been executed.",
  }));
}
