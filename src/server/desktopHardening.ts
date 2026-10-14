/**
 * Desktop reliability utilities: startup health evaluation, bounded retry
 * policy, and performance budget checks for packaged/local-first runtime.
 * Pure functions are separated from process lifecycle so they are testable
 * without spawning Electron or the Python sidecar.
 */

export type StartupComponent = "database" | "auth" | "python_sidecar" | "credential_vault" | "static_client";
export type ComponentHealth = "healthy" | "degraded" | "unavailable" | "disabled";

export interface ComponentStatus {
  component: StartupComponent;
  state: ComponentHealth;
  durationMs: number;
  detail: string;
}

export interface StartupHealthReport {
  ready: boolean;
  degraded: boolean;
  components: ComponentStatus[];
  unavailableComponents: StartupComponent[];
  totalDurationMs: number;
}

/**
 * Startup is ready when database/auth/static client are healthy. Sidecars
 * are optional and may degrade the app without preventing terminal startup.
 */
export function evaluateStartupHealth(components: ComponentStatus[]): StartupHealthReport {
  const required: StartupComponent[] = ["database", "auth", "static_client"];
  const unavailableComponents = components.filter((c) => c.state === "unavailable").map((c) => c.component);
  const requiredUnavailable = required.some((component) => unavailableComponents.includes(component));
  const degraded = components.some((c) => c.state === "degraded" || (c.state === "unavailable" && !required.includes(c.component)));

  return {
    ready: !requiredUnavailable,
    degraded,
    components,
    unavailableComponents,
    totalDurationMs: components.reduce((sum, c) => sum + Math.max(0, c.durationMs), 0),
  };
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_STARTUP_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  initialDelayMs: 250,
  maxDelayMs: 4_000,
  backoffMultiplier: 2,
};

export function getRetryDelay(attempt: number, policy: RetryPolicy = DEFAULT_STARTUP_RETRY_POLICY): number {
  if (!Number.isInteger(attempt) || attempt < 0) return policy.initialDelayMs;
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt));
}

export interface PerformanceBudget {
  name: string;
  budgetMs: number;
  actualMs: number;
}

export interface PerformanceBudgetResult {
  passed: boolean;
  budgets: Array<PerformanceBudget & { passed: boolean; overrunMs: number }>;
  totalOverrunMs: number;
}

export function evaluatePerformanceBudgets(budgets: PerformanceBudget[]): PerformanceBudgetResult {
  const evaluated = budgets.map((budget) => ({
    ...budget,
    passed: budget.actualMs <= budget.budgetMs,
    overrunMs: Math.max(0, budget.actualMs - budget.budgetMs),
  }));
  return {
    passed: evaluated.every((budget) => budget.passed),
    budgets: evaluated,
    totalOverrunMs: evaluated.reduce((sum, budget) => sum + budget.overrunMs, 0),
  };
}

export const DESKTOP_PERFORMANCE_BUDGETS: Record<string, number> = {
  startup: 5_000,
  database_init: 3_000,
  static_client_load: 3_000,
  readiness_request: 2_000,
  quote_request: 3_000,
  workspace_restore: 1_000,
};
