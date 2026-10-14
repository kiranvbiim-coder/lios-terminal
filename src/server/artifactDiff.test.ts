import assert from "node:assert/strict";
import test from "node:test";
import type { ArtifactContent } from "@shared/artifactContracts";
import { compareArtifactContents } from "./artifactDiff";

function compare(left: ArtifactContent, right: ArtifactContent) {
  return compareArtifactContents({
    artifactId: "artifact-semantic-diff",
    leftVersion: 1,
    rightVersion: 2,
    left,
    right,
  }) as any;
}

function valuation(input: {
  modelId?: string;
  wacc?: number;
  targetPrice?: number;
  baseline?: number;
}): ArtifactContent {
  return {
    kind: "valuation",
    symbol: "AAPL",
    modelId: input.modelId ?? "dcf",
    assumptions: {
      wacc: input.wacc ?? 0.10,
      baseline: input.baseline ?? 100,
      note: "semantic-diff ignores non-numeric metadata",
    },
    outputs: {
      targetPrice: input.targetPrice ?? 100,
    },
    summary: {},
  } as ArtifactContent;
}

function thesis(riskEntries: Array<{ id: string; text: string; status?: "open" | "materialized" | "mitigated" | "dismissed" }>): ArtifactContent {
  return {
    kind: "thesis",
    entityRef: "instrument:AAPL",
    status: "active",
    summary: "Long-term thesis",
    expectedOutcomes: [],
    claims: [],
    catalysts: [],
    risks: riskEntries.map((item) => ({
      id: item.id,
      text: item.text,
      status: item.status ?? "open",
      evidenceRefs: [],
    })),
    invalidationConditions: [],
    openQuestions: [],
    refresh: { lastRefreshedAt: null, snapshotId: null, contradictions: [], changes: [] },
    postmortems: [],
  } as ArtifactContent;
}

test("FinRobot semantic adaptation reports curated valuation numeric deltas", () => {
  const result = compare(
    valuation({ wacc: 0.10, targetPrice: 100 }),
    valuation({ wacc: 0.11, targetPrice: 95 }),
  );

  assert.ok(result.semantic, "semantic comparison must be emitted for valuation artifacts");
  const wacc = result.semantic.numericDeltas.find((item: any) => item.path === "assumptions.wacc");
  assert.deepEqual(wacc, {
    path: "assumptions.wacc",
    before: 0.10,
    after: 0.11,
    absoluteChange: 0.01,
    percentChange: 0.10,
    direction: "up",
    comparable: true,
  });
  assert.ok(result.semantic.numericDeltas.some((item: any) => item.path === "outputs.targetPrice"));
  assert.equal(result.semantic.numericDeltas.some((item: any) => item.path.includes("note")), false);
});

test("semantic numeric diff never fabricates a percentage from a zero baseline", () => {
  const result = compare(
    valuation({ baseline: 0 }),
    valuation({ baseline: 1 }),
  );
  const baseline = result.semantic.numericDeltas.find((item: any) => item.path === "assumptions.baseline");

  assert.equal(baseline.before, 0);
  assert.equal(baseline.after, 1);
  assert.equal(baseline.absoluteChange, 1);
  assert.equal(baseline.percentChange, null);
  assert.equal(baseline.comparable, true);
  assert.equal(Number.isFinite(baseline.absoluteChange), true);
});

test("model changes are explicit comparability blockers rather than like-for-like deltas", () => {
  const result = compare(
    valuation({ modelId: "dcf", wacc: 0.10, targetPrice: 100 }),
    valuation({ modelId: "residual-income", wacc: 0.11, targetPrice: 101 }),
  );

  assert.ok(result.semantic.comparability.some((flag: any) => flag.kind === "model" && flag.blocksAttribution));
  assert.ok(result.semantic.numericDeltas.every((item: any) => item.comparable === false));
  assert.equal(result.semantic.materialChange, true);
});

test("keyed thesis collections are order-insensitive and report only semantic ID changes", () => {
  const reordered = compare(
    thesis([
      { id: "risk-a", text: "Demand weakness" },
      { id: "risk-b", text: "Margin pressure" },
    ]),
    thesis([
      { id: "risk-b", text: "Margin pressure" },
      { id: "risk-a", text: "Demand weakness" },
    ]),
  );
  assert.equal(reordered.semantic.collectionDeltas.some((item: any) => item.path === "risks"), false);
  assert.equal(reordered.semantic.materialChange, false);

  const changed = compare(
    thesis([
      { id: "risk-a", text: "Demand weakness" },
      { id: "risk-b", text: "Margin pressure" },
    ]),
    thesis([
      { id: "risk-b", text: "Margin pressure increased", status: "materialized" },
      { id: "risk-c", text: "Regulatory change" },
    ]),
  );
  const risks = changed.semantic.collectionDeltas.find((item: any) => item.path === "risks");
  assert.deepEqual(risks, {
    path: "risks",
    addedIds: ["risk-c"],
    removedIds: ["risk-a"],
    changedIds: ["risk-b"],
  });
  assert.equal(changed.semantic.materialChange, true);
});

test("small comparable numeric drift is distinguished from a material conclusion change", () => {
  const drift = compare(
    valuation({ wacc: 0.10, targetPrice: 100 }),
    valuation({ wacc: 0.101, targetPrice: 101 }),
  );
  assert.equal(drift.semantic.materialChange, false);

  const material = compare(
    valuation({ wacc: 0.10, targetPrice: 100 }),
    valuation({ wacc: 0.105, targetPrice: 105 }),
  );
  assert.equal(material.semantic.materialChange, true);
});

test("semantic comparison leaves valuation attribution unavailable unless P11 supplies it", () => {
  const result = compare(
    valuation({ wacc: 0.10, targetPrice: 100 }),
    valuation({ wacc: 0.12, targetPrice: 90 }),
  );

  assert.deepEqual(result.semantic.attribution, {
    available: false,
    reason: "authoritative_p11_contributions_not_supplied",
    items: [],
    totalChange: null,
    residual: null,
  });
  assert.equal(JSON.stringify(result.semantic).includes("sourceRefs"), false);
});

function caliberValuation(input: {
  quoteCurrency?: unknown;
  reportingCurrency?: unknown;
  reportingPeriod?: unknown;
  targetPrice?: number;
  bookValuePerShare?: number;
  revenue?: number;
  netIncome?: number;
  wacc?: number;
}): ArtifactContent {
  const base = valuation({ wacc: input.wacc ?? 0.10, targetPrice: input.targetPrice ?? 100 });
  if (base.kind !== "valuation") throw new Error("Expected valuation fixture.");
  return {
    ...base,
    assumptions: { ...base.assumptions,
      ...(Object.prototype.hasOwnProperty.call(input, "quoteCurrency") ? { quoteCurrency: input.quoteCurrency } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "reportingCurrency") ? { reportingCurrency: input.reportingCurrency } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "reportingPeriod") ? { reportingPeriod: input.reportingPeriod } : {}),
    },
    outputs: { ...base.outputs, bookValuePerShare: input.bookValuePerShare ?? 12.5 },
    summary: { revenue: input.revenue ?? 500, netIncome: input.netIncome ?? 100 },
  };
}

test("FinRobot field caliber: changed quote currency blocks per-share deltas but not WACC", () => {
  const result = compare(
    caliberValuation({ quoteCurrency: "USD", targetPrice: 100, bookValuePerShare: 12.5, wacc: 0.10 }),
    caliberValuation({ quoteCurrency: "EUR", targetPrice: 120, bookValuePerShare: 13.5, wacc: 0.11 }),
  );
  const price = result.semantic.numericDeltas.find((x: any) => x.path === "outputs.targetPrice");
  const book = result.semantic.numericDeltas.find((x: any) => x.path === "outputs.bookValuePerShare");
  const wacc = result.semantic.numericDeltas.find((x: any) => x.path === "assumptions.wacc");
  for (const item of [price, book]) {
    assert.equal(item.comparable, false);
    assert.equal(item.absoluteChange, null);
    assert.equal(item.percentChange, null);
  }
  assert.equal(wacc.comparable, true, "non-currency assumptions do not inherit a false FX blocker");
  assert.equal(wacc.absoluteChange, 0.01);
  assert.ok(result.semantic.comparability.some((f: any) =>
    f.kind === "currency" && f.path === "outputs.bookValuePerShare" && f.blocksAttribution));
  assert.equal(result.semantic.materialChange, true);
});

test("FinRobot field caliber: mismatched reporting fiscal periods suppress comparable revenue changes", () => {
  const result = compare(
    caliberValuation({ reportingCurrency: "INR", reportingPeriod: "FY2024", revenue: 1000 }),
    caliberValuation({ reportingCurrency: "INR", reportingPeriod: "FY2025", revenue: 1200 }),
  );
  const revenue = result.semantic.numericDeltas.find((x: any) => x.path === "summary.revenue");
  assert.deepEqual({ comparable: revenue.comparable, delta: revenue.absoluteChange, pct: revenue.percentChange },
    { comparable: false, delta: null, pct: null });
  assert.ok(result.semantic.comparability.some((x: any) => x.kind === "period" && x.path === "summary.revenue"));
  assert.equal(result.semantic.materialChange, true);
});

test("FinRobot field caliber: a different or invalid vintage is material even when raw numbers match", () => {
  const left = caliberValuation({ reportingCurrency: "USD", reportingPeriod: "TTM", revenue: 500 });
  const right = caliberValuation({ reportingCurrency: "USD", reportingPeriod: "NTM", revenue: 500 });
  const period = compare(left, right);
  assert.equal(period.semantic.numericDeltas.some((x: any) => x.path === "summary.revenue"), false);
  assert.equal(period.semantic.comparability.some((x: any) => x.kind === "period" && x.blocksAttribution), true);
  assert.equal(period.semantic.materialChange, true);
  const untrusted = compare(
    caliberValuation({ quoteCurrency: "USD", targetPrice: 100 }),
    caliberValuation({ quoteCurrency: 123, targetPrice: 100 }),
  );
  assert.equal(untrusted.semantic.comparability.some((x: any) => x.kind === "currency"), true);
  assert.equal(JSON.stringify(untrusted.semantic).includes("123"), false,
    "malformed raw tag must never be repeated in generated explanations");
});

test("FinRobot field caliber: matched tags preserve exact deltas and sign-flip suppresses percent", () => {
  const left = caliberValuation({ quoteCurrency: "usd", reportingCurrency: "INR", reportingPeriod: "FY2025",
    targetPrice: 100, netIncome: -10 });
  const right = caliberValuation({ quoteCurrency: "USD", reportingCurrency: "INR", reportingPeriod: "FY2025",
    targetPrice: 110, netIncome: 10 });
  const result = compare(left, right);
  const price = result.semantic.numericDeltas.find((x: any) => x.path === "outputs.targetPrice");
  const net = result.semantic.numericDeltas.find((x: any) => x.path === "summary.netIncome");
  assert.equal(price.absoluteChange, 10);
  assert.equal(price.percentChange, 0.1);
  assert.equal(net.absoluteChange, 20);
  assert.equal(net.percentChange, null, "negative-to-positive income cannot be reported as a percentage return");
  assert.equal(net.comparable, true);
  assert.equal(result.semantic.comparability.length, 0);
});

test("FinRobot field caliber: one-sided currency tags and overflow do not publish fake arithmetic", () => {
  const untagged = compare(
    caliberValuation({ quoteCurrency: "USD", targetPrice: 100 }),
    caliberValuation({ targetPrice: 200 }),
  );
  const price = untagged.semantic.numericDeltas.find((x: any) => x.path === "outputs.targetPrice");
  assert.equal(price.comparable, false);
  assert.equal(price.percentChange, null);
  const overflow = compare(
    caliberValuation({ revenue: -1e308 }),
    caliberValuation({ revenue: 1e308 }),
  );
  const rev = overflow.semantic.numericDeltas.find((x: any) => x.path === "summary.revenue");
  assert.equal(rev.comparable, false);
  assert.equal(rev.absoluteChange, null);
  assert.equal(rev.percentChange, null);
  assert.ok(overflow.semantic.comparability.some((x: any) => x.kind === "method" && x.path === "summary.revenue"));
});
