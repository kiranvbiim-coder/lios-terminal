import test from "node:test";
import assert from "node:assert/strict";
import { defaultArtifactReportTemplate, generateReportPack, getReportTemplate, REPORT_TEMPLATES, resolveExplicitReportTemplate } from "./reportEngine";
import type { ReportGenerationInputs } from "./reportEngine";

test("report templates: all have unique ids", () => {
  const ids = REPORT_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("report choice resolves all registered display phrases and fixed aliases without first-match wins", () => {
  for (const template of REPORT_TEMPLATES) {
    assert.deepEqual(resolveExplicitReportTemplate(`Create ${template.name} from this Artifact`), {
      reportRequested: true, templateId: template.id, error: null,
    });
  }
  assert.equal(resolveExplicitReportTemplate("Create a portfolio report from this Artifact").templateId, "portfolio_review");
  assert.equal(resolveExplicitReportTemplate("Create company_tearsheet from this Artifact").templateId, "company_tearsheet");
  assert.equal(resolveExplicitReportTemplate("Create a DCF report from this Artifact").templateId, "dcf_model_pack");
  assert.deepEqual(resolveExplicitReportTemplate("Create a professional report from this Artifact"), {
    reportRequested: true, templateId: null, error: null,
  });
  const conflict = resolveExplicitReportTemplate("Create a Risk Report and Investment Memo from this Artifact");
  assert.equal(conflict.templateId, null);
  assert.match(conflict.error ?? "", /Choose one report template.*Risk Report|Choose one report template.*Investment Memo/);
  for (const message of ["Create a liquidity report from this Artifact", "Create a Risk Report and unicorn report from this Artifact"]) {
    const unknown = resolveExplicitReportTemplate(message);
    assert.equal(unknown.templateId, null);
    assert.match(unknown.error ?? "", /Unknown report template/);
  }
  assert.equal(resolveExplicitReportTemplate("Run reverse DCF").reportRequested, false);
});

test("artifact report defaults retain the original kind-based selection", () => {
  assert.equal(defaultArtifactReportTemplate("portfolio"), "portfolio_review");
  assert.equal(defaultArtifactReportTemplate("valuation"), "dcf_model_pack");
  assert.equal(defaultArtifactReportTemplate("decision"), "decision_receipt_report");
  assert.equal(defaultArtifactReportTemplate("table"), "investment_memo");
});

test("report templates: investment memo has expected sections", () => {
  const template = getReportTemplate("investment_memo");
  assert.ok(template);
  assert.ok(template.sectionOrder.includes("title"));
  assert.ok(template.sectionOrder.includes("summary"));
  assert.ok(template.sectionOrder.includes("key_metrics"));
  assert.ok(template.sectionOrder.includes("passport_appendix"));
});

test("report pack: generates complete pack from template", () => {
  const pack = generateReportPack({
    templateId: "dcf_model_pack",
    title: "AAPL DCF Analysis",
    subtitle: "Q3 2026 Update",
    symbol: "AAPL",
    engineId: "valuation.dcf",
    engineVersion: "1.0.0",
    sectionData: {
      summary: "Apple trades at a premium to intrinsic value based on our DCF model.",
      key_metrics: { impliedPrice: 195, currentPrice: 227, upside: -14.1 },
      assumptions: [{ key: "wacc", value: "10%", source: "Build-up method" }],
      limitations: ["Terminal growth rate assumed constant", "No segment-level granularity"],
    },
  });

  assert.ok(pack.id.startsWith("rpt_"));
  assert.equal(pack.templateId, "dcf_model_pack");
  assert.equal(pack.title, "AAPL DCF Analysis");
  assert.equal(pack.subtitle, "Q3 2026 Update");
  assert.ok(pack.sections.length >= 5);
  assert.equal(pack.metadata.symbol, "AAPL");
  assert.equal(pack.metadata.engineId, "valuation.dcf");
  assert.equal(pack.metadata.outputHash.length, 64);

  // Sections should be in template order
  const types = pack.sections.map((s) => s.type);
  assert.ok(types.indexOf("title") < types.indexOf("summary"));
  assert.ok(types.indexOf("summary") < types.indexOf("assumptions"));
});

test("report pack: includes passport appendix when passports provided", () => {
  const pack = generateReportPack({
    templateId: "decision_receipt_report",
    title: "Decision: AAPL Investment",
    sectionData: {},
    passports: [
      { id: "ppt_001", contractFamily: "financial_statements", entityKey: "AAPL", entries: [], quality: { level: "high", completeness: 1, freshnessScore: 0.9, conflictCount: 0, warnings: [] }, snapshotHash: "abc123", createdAt: "2026-08-25" },
    ],
  });
  assert.equal(pack.metadata.passportIds.length, 1);
  const appendix = pack.sections.find((s) => s.type === "passport_appendix");
  assert.ok(appendix);
  assert.ok(Array.isArray(appendix.content) && (appendix.content as unknown[]).length === 1);
});

test("report pack: unknown template throws", () => {
  assert.throws(() => {
    generateReportPack({ templateId: "nonexistent" as unknown as "investment_memo", title: "X", sectionData: {} });
  }, /Unknown report template/);
});

test("report pack: output hash is deterministic", () => {
  const inputs = { templateId: "company_tearsheet" as const, title: "MSFT", symbol: "MSFT", sectionData: {} };
  const a = generateReportPack(inputs);
  const b = generateReportPack(inputs);
  assert.equal(a.metadata.outputHash, b.metadata.outputHash);
  assert.notEqual(a.id, b.id);
});

function reportInputs(overrides: Partial<ReportGenerationInputs> = {}): ReportGenerationInputs {
  return {
    templateId: "investment_memo",
    title: "MSFT Investment Memo",
    subtitle: "Normalized fixture",
    symbol: "MSFT",
    engineId: "valuation.dcf",
    engineVersion: "1.0.0",
    sectionData: {
      summary: { thesis: "durable growth", confidence: 0.8 },
      key_metrics: { impliedPrice: 420, currentPrice: 400 },
    },
    passports: [{
      id: "ppt_msft_001",
      contractFamily: "financial_statements",
      entityKey: "MSFT",
      entries: [{
        field: "revenue",
        value: 100,
        source: { connectorId: "filings", provider: "sec", priority: "primary" },
        retrievedAt: "2026-08-01T00:00:00.000Z",
        freshnessDays: 5,
        currency: "USD",
        unit: "millions",
        period: "FY2025",
        normalizations: [],
      }],
      quality: { level: "high", completeness: 1, freshnessScore: 0.99, conflictCount: 0, warnings: [] },
      snapshotHash: "passport_snapshot_001",
      createdAt: "2026-08-01T00:00:00.000Z",
    }],
    receipt: {
      id: "receipt_001",
      snapshotHash: "receipt_snapshot_001",
      outputHash: "receipt_output_001",
      recommendation: "hold",
    },
    ...overrides,
  };
}

test("report pack: section content, receipt identity, provenance, and engine version are hash identity", () => {
  const baseline = generateReportPack(reportInputs()).metadata.outputHash;

  assert.notEqual(
    generateReportPack(reportInputs({
      sectionData: { summary: { thesis: "different thesis", confidence: 0.8 } },
    })).metadata.outputHash,
    baseline,
    "material section content must change the hash",
  );
  assert.notEqual(
    generateReportPack(reportInputs({
      receipt: { ...reportInputs().receipt!, id: "receipt_002" },
    })).metadata.outputHash,
    baseline,
    "receipt ids must change the hash",
  );
  assert.notEqual(
    generateReportPack(reportInputs({
      receipt: { ...reportInputs().receipt!, outputHash: "receipt_output_002" },
    })).metadata.outputHash,
    baseline,
    "receipt output hashes must change the hash",
  );
  assert.notEqual(
    generateReportPack(reportInputs({
      receipt: { ...reportInputs().receipt!, snapshotHash: "receipt_snapshot_002" },
    })).metadata.outputHash,
    baseline,
    "receipt snapshot hashes must change the hash",
  );
  assert.notEqual(
    generateReportPack(reportInputs({ engineVersion: "1.0.1" })).metadata.outputHash,
    baseline,
    "engine/model versions must change the hash",
  );

  const passport = reportInputs().passports![0];
  const changedSourcePassport = {
    ...passport,
    entries: [{
      ...passport.entries[0],
      source: { ...passport.entries[0].source, provider: "alternate-sec" },
    }],
  };
  assert.notEqual(
    generateReportPack(reportInputs({ passports: [changedSourcePassport] })).metadata.outputHash,
    baseline,
    "passport source references must change the hash",
  );

  assert.notEqual(
    generateReportPack(reportInputs({
      passports: [{ ...passport, id: "ppt_msft_002" }],
    })).metadata.outputHash,
    baseline,
    "passport ids must change the hash",
  );
  assert.notEqual(
    generateReportPack(reportInputs({
      passports: [{ ...passport, snapshotHash: "passport_snapshot_002" }],
    })).metadata.outputHash,
    baseline,
    "passport snapshot hashes must change the hash",
  );
});

test("report pack: canonical hash ignores object key order but not report identity", () => {
  const first = generateReportPack(reportInputs({
    sectionData: { summary: { alpha: 1, nested: { first: "a", second: "b" } } },
  }));
  const reordered = generateReportPack(reportInputs({
    sectionData: { summary: { nested: { second: "b", first: "a" }, alpha: 1 } },
  }));

  assert.equal(first.metadata.outputHash, reordered.metadata.outputHash);
  assert.notEqual(first.id, reordered.id);
});

test("report pack: output hash is a digest and does not expose section secrets", () => {
  const secret = "synthetic-test-secret-do-not-log";
  const pack = generateReportPack(reportInputs({
    sectionData: { summary: { secret } },
  }));

  assert.match(pack.metadata.outputHash, /^[a-f0-9]{64}$/);
  assert.ok(!pack.metadata.outputHash.includes(secret));
});

test("report pack: sources appendix aggregates real provider/field metadata, not an empty stub", () => {
  const pack = generateReportPack(reportInputs({
    templateId: "investment_memo",
    passports: [{
      id: "ppt_1",
      contractFamily: "financial_statements",
      entityKey: "AAPL",
      entries: [
        { field: "revenue", value: 100, source: { connectorId: "sec_edgar", provider: "SEC EDGAR", priority: "primary" }, retrievedAt: "2026-08-01T00:00:00.000Z", freshnessDays: 1, normalizations: [] },
        { field: "netIncome", value: 20, source: { connectorId: "sec_edgar", provider: "SEC EDGAR", priority: "primary" }, retrievedAt: "2026-08-01T00:00:00.000Z", freshnessDays: 1, normalizations: [] },
        // A pin forced this field to a specific provider -- manual_override
        // is the signal a P0.3 conflict pin produces (see dataTruth.ts).
        { field: "eps", value: 6.1, source: { connectorId: "finnhub", provider: "Finnhub", priority: "manual_override" }, retrievedAt: "2026-08-01T00:00:00.000Z", freshnessDays: 1, normalizations: [] },
      ],
      quality: { level: "high", completeness: 1, freshnessScore: 0.9, conflictCount: 0, warnings: [] },
      snapshotHash: "hash1",
      createdAt: "2026-08-01T00:00:00.000Z",
    }],
  }));
  const sources = pack.sections.find((s) => s.type === "sources");
  assert.ok(sources);
  const content = sources.content as Array<{ provider: string; connectorId: string; priority: string; fields: string[] }>;
  assert.equal(content.length, 2);
  const sec = content.find((s) => s.provider === "SEC EDGAR");
  assert.ok(sec);
  assert.deepEqual(sec!.fields, ["netIncome", "revenue"]);
  assert.equal(sec!.priority, "primary");
  const finnhub = content.find((s) => s.provider === "Finnhub");
  assert.ok(finnhub);
  assert.equal(finnhub!.priority, "manual_override", "a pinned field's source must surface as manual_override, not silently downgraded");
});

test("report pack: passport appendix entries carry per-field source and conflict provenance", () => {
  const pack = generateReportPack(reportInputs({
    templateId: "investment_memo",
    passports: [{
      id: "ppt_1",
      contractFamily: "financial_statements",
      entityKey: "AAPL",
      entries: [{
        field: "revenue",
        value: 100,
        source: { connectorId: "sec_edgar", provider: "SEC EDGAR", priority: "primary" },
        retrievedAt: "2026-08-01T00:00:00.000Z",
        freshnessDays: 1,
        normalizations: [],
        conflict: {
          field: "revenue",
          values: [{ value: 100, connectorId: "sec_edgar", provider: "SEC EDGAR", retrievedAt: "2026-08-01T00:00:00.000Z", quality: "high" }, { value: 99, connectorId: "finnhub", provider: "Finnhub", retrievedAt: "2026-08-01T00:00:00.000Z", quality: "medium" }],
          resolvedValue: 100,
          strategy: "primary_source",
          resolvedFrom: "sec_edgar",
          reason: "Ranked highest in this capability's provider priority order.",
        },
      }],
      quality: { level: "high", completeness: 1, freshnessScore: 0.9, conflictCount: 1, warnings: [] },
      snapshotHash: "hash1",
      createdAt: "2026-08-01T00:00:00.000Z",
    }],
  }));
  const appendix = pack.sections.find((s) => s.type === "passport_appendix");
  assert.ok(appendix);
  const content = appendix.content as Array<{ entries: Array<{ field: string; source: { provider: string }; conflict: { strategy: string; alternativeCount: number } | null }> }>;
  assert.equal(content[0].entries.length, 1);
  assert.equal(content[0].entries[0].field, "revenue");
  assert.equal(content[0].entries[0].source.provider, "SEC EDGAR");
  assert.ok(content[0].entries[0].conflict);
  assert.equal(content[0].entries[0].conflict!.strategy, "primary_source");
  assert.equal(content[0].entries[0].conflict!.alternativeCount, 2);
});
