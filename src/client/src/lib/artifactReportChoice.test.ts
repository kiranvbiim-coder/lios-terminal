import test from "node:test";
import assert from "node:assert/strict";
import { artifactRefreshSpecSchema } from "@shared/artifactContracts";
import { listReportTemplates, REPORT_TEMPLATES } from "../../../server/reportEngine";
import {
  artifactReportSourceError, canonicalArtifactReportTemplates, prepareArtifactReportRequest, recommendedArtifactReportTemplate,
  type ArtifactReportSource,
} from "./artifactReportChoice";

const source: ArtifactReportSource = {
  artifactId: "saved-risk-workbook", versionArtifactId: "saved-risk-workbook", projectId: 7,
  version: 3, headVersion: 3, contentHash: "a".repeat(64),
};
const templates = canonicalArtifactReportTemplates({ existingTemplates: listReportTemplates() });

function prepare(templateId: string, current = source) {
  return prepareArtifactReportRequest({ templateId, templates, title: "Recorded workbook", captured: source, current });
}

test("choices use only the real reportEngine catalogue, never the separate Wave D templates", () => {
  const choices = canonicalArtifactReportTemplates({ templates: [{ id: "invented-board-brief", name: "Board Brief", description: "Not the reportEngine catalogue" }], existingTemplates: listReportTemplates() });
  assert.deepEqual(choices.map((item) => item.id), REPORT_TEMPLATES.map((item) => item.id));
  assert.equal(choices.some((item) => item.id === "invented-board-brief"), false);
  assert.throws(() => canonicalArtifactReportTemplates({ templates: listReportTemplates() }));
  assert.throws(() => canonicalArtifactReportTemplates({ existingTemplates: [] }));
  assert.throws(() => canonicalArtifactReportTemplates({ existingTemplates: [{ id: "broken", name: "Broken" }] }));
  assert.throws(() => canonicalArtifactReportTemplates({ existingTemplates: [choices[0], choices[0]] }), /duplicate/);
});

test("kind recommendations match runtime defaults but never fabricate unavailable choices", () => {
  assert.equal(recommendedArtifactReportTemplate("portfolio", templates), "portfolio_review");
  assert.equal(recommendedArtifactReportTemplate("valuation", templates), "dcf_model_pack");
  assert.equal(recommendedArtifactReportTemplate("decision", templates), "decision_receipt_report");
  assert.equal(recommendedArtifactReportTemplate("spreadsheet", templates), "investment_memo");
  assert.equal(recommendedArtifactReportTemplate("report", templates), "investment_memo");
  assert.equal(recommendedArtifactReportTemplate("portfolio", templates.filter((item) => item.id !== "portfolio_review")), "");
  assert.equal(recommendedArtifactReportTemplate("research", []), "");
});

test("every actual template stages its exact display name with saved Artifact and no inherited provider or engine posture", () => {
  for (const template of REPORT_TEMPLATES) {
    const request = prepare(template.id);
    assert.equal(request.message, `Create ${template.name} from this Artifact`);
    assert.equal(request.kind, "conversation");
    assert.equal(request.sourceScope, "my_data");
    assert.equal(request.executionMode, "deterministic_first");
    assert.deepEqual(request.capabilityIds, ["research.report"]);
    assert.deepEqual(request.selection, { kind: "artifact", id: source.artifactId, label: "Recorded workbook", view: null, symbol: null });
    assert.equal(request.engineRef, null);
    assert.deepEqual(artifactRefreshSpecSchema.parse(request), request);
  }
});

test("explicit Risk Report overrides the spreadsheet recommendation, without falling back on empty or stale choices", () => {
  assert.equal(recommendedArtifactReportTemplate("spreadsheet", templates), "investment_memo");
  assert.equal(prepare("risk_report").message, "Create Risk Report from this Artifact");
  assert.throws(() => prepare(""), /Choose a report structure/);
  assert.throws(() => prepare("not-in-catalogue"), /Choose a report structure/);
  assert.throws(() => prepareArtifactReportRequest({ templateId: "risk_report", templates: templates.filter((item) => item.id !== "risk_report"), title: "Recorded workbook", captured: source, current: source }), /current catalogue/);
});

test("selection, Project, version, head, and hash changes reject the captured source rather than substituting new data", () => {
  assert.equal(artifactReportSourceError(source, { ...source }), null);
  for (const changed of [
    { ...source, artifactId: "other-artifact" },
    { ...source, versionArtifactId: "other-artifact" },
    { ...source, projectId: 8 },
    { ...source, version: 4 },
    { ...source, headVersion: 4 },
    { ...source, contentHash: "b".repeat(64) },
  ]) {
    assert.match(artifactReportSourceError(source, changed)!, /revision changed/);
    assert.throws(() => prepare("risk_report", changed), /revision changed/);
  }
  const historic = { ...source, headVersion: 4 };
  assert.match(artifactReportSourceError(historic, historic)!, /not the current Artifact head/);
  for (const incomplete of [
    { ...source, artifactId: "" },
    { ...source, versionArtifactId: "other-artifact" },
    { ...source, projectId: 0 },
    { ...source, version: 0 },
    { ...source, version: 1.5 },
    { ...source, contentHash: " " },
  ]) assert.match(artifactReportSourceError(incomplete, incomplete)!, /incomplete/);
});
