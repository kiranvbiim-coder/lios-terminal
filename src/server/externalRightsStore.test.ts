import assert from "node:assert/strict";
import test from "node:test";
import { validateExternalRightsAssessmentInput } from "./externalRightsStore";

const valid = {
  subjectId: "provider:openfigi",
  subjectKind: "combined" as const,
  rights: {
    softwareLicense: { spdx: "Apache-2.0", reviewed: true },
    apiTerms: { provider: "OpenFIGI", reviewed: true, termsUrl: "https://www.openfigi.com/api" },
    dataRights: { redistribution: "unknown" as const, internalUse: "unknown" as const, attributionRequired: false },
    trademarkReviewed: false,
  },
  notes: "API/data rights remain a separate review from connector code licensing.",
  reviewedAt: "2026-09-22T06:30:00.000Z",
};

test("P5 rights assessment keeps code license API terms data rights and trademark review separate", () => {
  const parsed = validateExternalRightsAssessmentInput(valid);
  assert.equal(parsed.rights.softwareLicense.spdx, "Apache-2.0");
  assert.equal(parsed.rights.apiTerms.provider, "OpenFIGI");
  assert.equal(parsed.rights.dataRights.redistribution, "unknown");
  assert.equal(parsed.rights.trademarkReviewed, false);
});

test("P5 rights assessment rejects credential-bearing references", () => {
  assert.throws(() => validateExternalRightsAssessmentInput({
    ...valid,
    rights: {
      ...valid.rights,
      apiTerms: { ...valid.rights.apiTerms, termsUrl: "https://example.test/terms?api_key=secret-value" },
    },
  }), /must not contain credentials/i);
});
