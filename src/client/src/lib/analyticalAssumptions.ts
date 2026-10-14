import { analyticalFingerprint, type AnalyticalPrimitive } from "./analyticalCore";

export type AnalyticalAssumptionScope = "global" | "portfolio" | "object" | "model";
export type AnalyticalAssumptionSource = "default" | "observed" | "analyst" | "scenario";

export interface AnalyticalAssumption {
  key: string;
  label: string;
  value: AnalyticalPrimitive;
  unit?: string;
  scope: AnalyticalAssumptionScope;
  scopeId?: string;
  source: AnalyticalAssumptionSource;
  locked: boolean;
  updatedAt: string;
  note?: string;
}

export interface AssumptionResolutionContext {
  modelId?: string;
  objectId?: string;
  portfolioId?: string;
}

export interface AnalyticalAssumptionSnapshot {
  assumptions: AnalyticalAssumption[];
  fingerprint: string;
}

function recordId(assumption: Pick<AnalyticalAssumption, "key" | "scope" | "scopeId">): string {
  return `${assumption.scope}:${assumption.scopeId ?? "*"}:${assumption.key}`;
}

function validScopeId(scope: AnalyticalAssumptionScope, scopeId?: string): boolean {
  return scope === "global" ? !scopeId : Boolean(scopeId?.trim());
}

export class AnalyticalAssumptionRegistry {
  private readonly records = new Map<string, AnalyticalAssumption>();

  set(assumption: AnalyticalAssumption, options: { force?: boolean } = {}): this {
    if (!validScopeId(assumption.scope, assumption.scopeId)) {
      throw new Error(`Assumption ${assumption.key} requires a scopeId for ${assumption.scope} scope, and none for global scope.`);
    }
    const id = recordId(assumption);
    const existing = this.records.get(id);
    if (existing?.locked && !options.force) {
      const changed = existing.value !== assumption.value || existing.unit !== assumption.unit || existing.source !== assumption.source;
      if (changed) throw new Error(`Assumption ${assumption.key} is locked at ${assumption.scope}:${assumption.scopeId ?? "*"}.`);
    }
    this.records.set(id, { ...assumption, scopeId: assumption.scope === "global" ? undefined : assumption.scopeId?.trim() });
    return this;
  }

  upsert(
    key: string,
    value: AnalyticalPrimitive,
    options: Omit<AnalyticalAssumption, "key" | "value" | "updatedAt"> & { updatedAt?: string; force?: boolean },
  ): this {
    const { force, updatedAt, ...rest } = options;
    return this.set({ key, value, updatedAt: updatedAt ?? new Date().toISOString(), ...rest }, { force });
  }

  getExact(key: string, scope: AnalyticalAssumptionScope, scopeId?: string): AnalyticalAssumption | undefined {
    return this.records.get(recordId({ key, scope, scopeId }));
  }

  resolve(key: string, context: AssumptionResolutionContext = {}): AnalyticalAssumption | undefined {
    const candidates: Array<[AnalyticalAssumptionScope, string | undefined]> = [
      ["model", context.modelId],
      ["object", context.objectId],
      ["portfolio", context.portfolioId],
      ["global", undefined],
    ];
    for (const [scope, scopeId] of candidates) {
      if (scope !== "global" && !scopeId) continue;
      const assumption = this.getExact(key, scope, scopeId);
      if (assumption) return assumption;
    }
    return undefined;
  }

  resolveMany(keys: readonly string[], context: AssumptionResolutionContext = {}): Record<string, AnalyticalAssumption> {
    const result: Record<string, AnalyticalAssumption> = {};
    for (const key of keys) {
      const assumption = this.resolve(key, context);
      if (assumption) result[key] = assumption;
    }
    return result;
  }

  setLocked(key: string, scope: AnalyticalAssumptionScope, scopeId: string | undefined, locked: boolean): this {
    const id = recordId({ key, scope, scopeId });
    const existing = this.records.get(id);
    if (!existing) throw new Error(`Cannot ${locked ? "lock" : "unlock"} missing assumption ${key}.`);
    this.records.set(id, { ...existing, locked, updatedAt: new Date().toISOString() });
    return this;
  }

  remove(key: string, scope: AnalyticalAssumptionScope, scopeId?: string, options: { force?: boolean } = {}): boolean {
    const id = recordId({ key, scope, scopeId });
    const existing = this.records.get(id);
    if (!existing) return false;
    if (existing.locked && !options.force) throw new Error(`Assumption ${key} is locked and cannot be removed.`);
    return this.records.delete(id);
  }

  list(): AnalyticalAssumption[] {
    return Array.from(this.records.values()).sort((a, b) => a.key.localeCompare(b.key) || a.scope.localeCompare(b.scope) || (a.scopeId ?? "").localeCompare(b.scopeId ?? ""));
  }

  snapshot(): AnalyticalAssumptionSnapshot {
    const assumptions = this.list();
    return { assumptions, fingerprint: analyticalFingerprint(assumptions) };
  }

  affectedContexts(key: string): Array<Pick<AnalyticalAssumption, "scope" | "scopeId">> {
    return this.list().filter((assumption) => assumption.key === key).map(({ scope, scopeId }) => ({ scope, scopeId }));
  }
}

export const analyticalAssumptions = new AnalyticalAssumptionRegistry();
