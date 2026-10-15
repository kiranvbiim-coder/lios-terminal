import { and, eq, inArray } from "drizzle-orm";
import { decisionCases, decisionMonitoringRules } from "@shared/schema";
import { getDb } from "./db";
import { evaluateMonitoringRule } from "./decisionEngine";
import { getQuotes } from "./marketData";
import { getIndicatorQuotes } from "./fredData";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { emitP9AutomationEvent } from "./p9AutomationService";

export interface DecisionIndicatorReference {
  kind: "quote" | "fred";
  key: string;
}

export interface DecisionMonitorCycleResult {
  evaluated: number;
  breached: number;
  recovered: number;
  skipped: number;
}

export function parseDecisionIndicator(indicator: string): DecisionIndicatorReference | null {
  const separator = indicator.indexOf(":");
  if (separator < 1) return null;
  const kind = indicator.slice(0, separator).trim().toLowerCase();
  const key = indicator.slice(separator + 1).trim();
  if (!key || (kind !== "quote" && kind !== "fred")) return null;
  return { kind, key: key.toUpperCase() };
}

/**
 * An acknowledged threshold remains acknowledged while the breach persists.
 * A real recovery re-arms the rule for a later genuine breach.
 * The caller retains the existing database, permission and audit authorities.
 */
export function classifyDecisionMonitorTransition(
  previousStatus: string,
  isBreached: boolean,
): { nextStatus: "active" | "breached" | "acknowledged"; emitBreach: boolean; emitRecovery: boolean } {
  const wasBreached = previousStatus === "breached" || previousStatus === "acknowledged";
  return {
    nextStatus: isBreached
      ? previousStatus === "acknowledged" ? "acknowledged" : "breached"
      : "active",
    emitBreach: isBreached && !wasBreached,
    emitRecovery: !isBreached && wasBreached,
  };
}

export async function runDecisionMonitoringCycle(): Promise<DecisionMonitorCycleResult> {
  const rows = await getDb().select({ rule: decisionMonitoringRules, decision: decisionCases })
    .from(decisionMonitoringRules)
    .innerJoin(decisionCases, eq(decisionMonitoringRules.decisionId, decisionCases.id))
    .where(and(
      inArray(decisionMonitoringRules.status, ["active", "breached", "acknowledged"]),
      inArray(decisionCases.status, ["approved", "review"]),
    ));
  const references = rows.map((row) => parseDecisionIndicator(row.rule.indicator));
  const quoteSymbols = Array.from(new Set(references.flatMap((reference) => reference?.kind === "quote" ? [reference.key] : [])));
  const fredSeries = Array.from(new Set(references.flatMap((reference) => reference?.kind === "fred" ? [reference.key] : [])));
  const [quotes, indicators] = await Promise.all([
    quoteSymbols.length ? getQuotes(quoteSymbols) : Promise.resolve([]),
    fredSeries.length ? getIndicatorQuotes(fredSeries) : Promise.resolve([]),
  ]);
  const values = new Map<string, number>();
  for (const quote of quotes) if (Number.isFinite(quote.price)) values.set(`quote:${quote.symbol.toUpperCase()}`, quote.price);
  for (const indicator of indicators) if (typeof indicator.value === "number" && Number.isFinite(indicator.value)) values.set(`fred:${indicator.seriesId.toUpperCase()}`, indicator.value);

  let evaluated = 0;
  let breached = 0;
  let recovered = 0;
  let skipped = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const reference = references[index];
    if (!reference) {
      skipped += 1;
      continue;
    }
    const currentValue = values.get(`${reference.kind}:${reference.key}`);
    if (currentValue === undefined) {
      skipped += 1;
      continue;
    }
    const isBreached = evaluateMonitoringRule(row.rule.operator, row.rule.threshold, currentValue);
    evaluated += 1;
    const transition = classifyDecisionMonitorTransition(row.rule.status, isBreached);
    await getDb().update(decisionMonitoringRules).set({
      currentValue,
      lastEvaluatedAt: new Date(),
      status: transition.nextStatus,
      breachedAt: isBreached ? row.rule.breachedAt ?? new Date() : null,
      acknowledgedAt: isBreached ? row.rule.acknowledgedAt : null,
      sourceUrl: reference.kind === "fred" ? `https://fred.stlouisfed.org/series/${reference.key}` : `market:${reference.key}`,
    }).where(eq(decisionMonitoringRules.id, row.rule.id));
    if (transition.emitBreach) {
      breached += 1;
      await recordAuditEvent(row.rule.createdByUserId, "decision_monitor_breached", { decisionId: row.rule.decisionId, monitoringRuleId: row.rule.id, currentValue, action: row.rule.action, ...auditActor({ id: row.rule.createdByUserId, email: "decision-monitor" }) });
      await emitP9AutomationEvent({
        eventType: "risk_threshold",
        occurredAt: new Date().toISOString(),
        projectId: null,
        ownerUserId: row.rule.createdByUserId,
        organizationId: null,
        sourceRef: "decision-monitor:" + row.rule.id,
        payload: {
          decisionId: row.rule.decisionId,
          monitoringRuleId: row.rule.id,
          currentValue,
          action: row.rule.action,
        },
      });
    } else if (transition.emitRecovery) {
      recovered += 1;
      await recordAuditEvent(row.rule.createdByUserId, "decision_monitor_recovered", { decisionId: row.rule.decisionId, monitoringRuleId: row.rule.id, currentValue, ...auditActor({ id: row.rule.createdByUserId, email: "decision-monitor" }) });
    }
  }
  return { evaluated, breached, recovered, skipped };
}
