import type { EvidenceSnapshot } from "./terminalEvidence";
import {
  createIntelligenceObject,
  loadIntelligenceObjects,
  saveIntelligenceObjects,
  upsertIntelligenceObject,
  type IntelligenceObject,
} from "./terminalIntelligenceObjects";
import type { TerminalLensId } from "./terminalLensStack";
import type { TerminalScenario } from "./terminalScenarioUniverse";
import type { TerminalTimeContext } from "./terminalTimeTravel";
import type { ViewMode } from "./terminalTypes";

export interface HeroIntelligenceConfig {
  view: ViewMode;
  label: string;
  lenses: TerminalLensId[];
  scenarioAware: boolean;
  pointInTimeRelevant: boolean;
  nextViews: ViewMode[];
  objectTags: string[];
}

const HERO_CONFIGS: Partial<Record<ViewMode, HeroIntelligenceConfig>> = {
  entity: { view: "entity", label: "ENTITY 360", lenses: ["financial", "valuation", "risk", "market", "evidence", "decision"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["companyfundamentals", "financialstatements", "valuation", "peercomp", "advancedrisk"], objectTags: ["hero", "entity"] },
  companyfundamentals: { view: "companyfundamentals", label: "FUNDAMENTALS", lenses: ["financial", "valuation", "evidence"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["financialstatements", "valuation", "peercomp"], objectTags: ["hero", "fundamentals"] },
  financialstatements: { view: "financialstatements", label: "FINANCIAL STATEMENTS", lenses: ["financial", "valuation", "evidence"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["valuation", "peercomp", "advancedrisk"], objectTags: ["hero", "financials"] },
  valuation: { view: "valuation", label: "VALUATION", lenses: ["valuation", "financial", "risk", "evidence", "decision"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["peercomp", "advancedrisk", "research"], objectTags: ["hero", "valuation"] },
  peercomp: { view: "peercomp", label: "PEER COMPS", lenses: ["valuation", "financial", "market", "evidence"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["valuation", "advancedrisk", "chart"], objectTags: ["hero", "peers"] },
  portfolio: { view: "portfolio", label: "PORTFOLIO", lenses: ["risk", "market", "macro", "decision"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["portfolioattribution", "advancedrisk", "portfoliostress", "regime"], objectTags: ["hero", "portfolio"] },
  advancedrisk: { view: "advancedrisk", label: "RISK", lenses: ["risk", "market", "macro", "evidence", "decision"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["portfoliostress", "montecarlo", "correlation", "alerts"], objectTags: ["hero", "risk"] },
  macrodashboard: { view: "macrodashboard", label: "MACRO", lenses: ["macro", "market", "policy", "evidence"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["indicatorworkbench", "crossasset", "regime", "macrostress"], objectTags: ["hero", "macro"] },
  research: { view: "research", label: "RESEARCH", lenses: ["evidence", "decision", "risk"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["valuation", "advancedrisk", "alerts", "decisionmemory"], objectTags: ["hero", "research"] },
  crossdomainfusion: { view: "crossdomainfusion", label: "CROSS-DOMAIN FUSION", lenses: ["financial", "macro", "policy", "supply-chain", "sustainability", "risk", "evidence"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["crossasset", "supplychaindashboard", "environmentdashboard", "valuation"], objectTags: ["hero", "cross-domain"] },
  supplychaindashboard: { view: "supplychaindashboard", label: "SUPPLY CHAIN", lenses: ["supply-chain", "risk", "financial", "evidence"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["supplychainquant", "financialstatements", "advancedrisk"], objectTags: ["hero", "supply-chain"] },
  environmentdashboard: { view: "environmentdashboard", label: "SUSTAINABILITY", lenses: ["sustainability", "policy", "risk", "financial", "evidence"], scenarioAware: true, pointInTimeRelevant: true, nextViews: ["environmentquant", "carbonintensity", "valuation"], objectTags: ["hero", "sustainability"] },
};

export function getHeroIntelligenceConfig(view: ViewMode): HeroIntelligenceConfig | null {
  const config = HERO_CONFIGS[view];
  return config ? { ...config, lenses: [...config.lenses], nextViews: [...config.nextViews], objectTags: [...config.objectTags] } : null;
}

export function isHeroIntelligenceView(view: ViewMode): boolean {
  return Boolean(HERO_CONFIGS[view]);
}

function valueDisplay(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
  return String(value);
}

function modelIdentity(item: IntelligenceObject): string {
  return `${item.kind}|${item.symbol ?? ""}|${String(item.metadata.reproducibilityId ?? item.label)}`;
}

export function publishHeroEvidenceObjects(input: {
  view: ViewMode;
  symbol?: string;
  evidence: EvidenceSnapshot;
  scenario?: TerminalScenario | null;
  timeContext?: TerminalTimeContext;
}): IntelligenceObject[] {
  const config = getHeroIntelligenceConfig(input.view);
  if (!config) return loadIntelligenceObjects();
  let objects = loadIntelligenceObjects();
  const symbol = input.symbol?.trim().toUpperCase() || undefined;
  const scenario = input.scenario ?? null;
  const timeContext = input.timeContext;

  for (const source of input.evidence.provenance) {
    const object = createIntelligenceObject({
      kind: "evidence",
      label: source.label,
      description: `${source.source}${source.provider ? ` · ${source.provider}` : ""}`,
      symbol,
      view: input.view,
      status: source.quality === "warning" ? "warning" : source.quality === "unavailable" ? "critical" : "stable",
      tags: [...config.objectTags, "evidence", source.freshness],
      source: {
        label: source.source,
        provider: source.provider,
        sourceId: source.id,
        sourceUrl: source.sourceUrl,
        retrievedAt: source.retrievedAt,
        effectiveAt: source.effectiveAt,
        freshness: source.freshness,
      },
      assumptions: {},
      metadata: {
        quality: source.quality,
        conflictCount: source.conflicts.length,
        transformationCount: source.transformations.length,
        scenarioId: scenario?.id ?? null,
        asOfDate: timeContext?.enabled ? timeContext.asOfDate : null,
      },
    });
    objects = upsertIntelligenceObject(objects, object, (item) => `${item.kind}|${item.symbol ?? ""}|${item.source?.sourceId ?? item.label}`);
  }

  for (const receipt of input.evidence.receipts.slice(0, 8)) {
    const model = createIntelligenceObject({
      kind: "model",
      label: receipt.label,
      description: `${receipt.engine}${receipt.engineVersion ? ` v${receipt.engineVersion}` : ""}`,
      symbol,
      view: input.view,
      status: receipt.warnings.length ? "warning" : "stable",
      tags: [...config.objectTags, "model", "calculation-receipt"],
      assumptions: { ...receipt.inputs, ...receipt.parameters },
      metadata: {
        reproducibilityId: receipt.reproducibilityId,
        warningCount: receipt.warnings.length,
        diagnosticCount: receipt.diagnostics.length,
        modelVersion: receipt.modelVersion ?? null,
        scenarioId: scenario?.id ?? null,
        asOfDate: timeContext?.enabled ? timeContext.asOfDate : null,
      },
    });
    const identity = modelIdentity(model);
    objects = upsertIntelligenceObject(objects, model, modelIdentity);
    const persistedModelId = objects.find((item) => modelIdentity(item) === identity)?.id ?? model.id;

    for (const [key, raw] of Object.entries(receipt.outputs).slice(0, 24)) {
      const metric = createIntelligenceObject({
        kind: "metric",
        label: key,
        description: `${receipt.label} output`,
        symbol,
        view: input.view,
        status: receipt.warnings.length ? "warning" : "stable",
        value: { raw, display: valueDisplay(raw) },
        tags: [...config.objectTags, "output", receipt.engine.toLowerCase()],
        assumptions: {},
        metadata: {
          metricKey: key,
          receiptId: receipt.id,
          reproducibilityId: receipt.reproducibilityId,
          scenarioId: scenario?.id ?? null,
          asOfDate: timeContext?.enabled ? timeContext.asOfDate : null,
        },
        relations: [{ targetId: persistedModelId, kind: "derived-from" }],
      });
      objects = upsertIntelligenceObject(objects, metric, (item) => `${item.kind}|${item.symbol ?? ""}|${String(item.metadata.metricKey ?? item.label)}|${String(item.metadata.reproducibilityId ?? "")}`);
    }
  }

  saveIntelligenceObjects(objects);
  return objects;
}

export function heroWorkflowViews(view: ViewMode): ViewMode[] {
  return getHeroIntelligenceConfig(view)?.nextViews ?? [];
}
