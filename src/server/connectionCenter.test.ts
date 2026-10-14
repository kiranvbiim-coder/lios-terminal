import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_CENTER_CATEGORIES,
  CONNECTOR_SETUP_STAGES,
  buildPersistableDataProviderConnection,
  canAdvanceConnectionSetup,
  normalizeConnectionTestResult,
  validateDataProviderDraft,
  type DataProviderSetupDraft,
} from "../shared/connectionCenter";

const validDraft: DataProviderSetupDraft = {
  name: "Acme Market Data",
  endpoint: "https://api.acme.example/v1/data",
  protocol: "rest",
  method: "GET",
  authMode: "bearer",
  credential: "example-credential-value",
  credentialRef: null,
  responsePath: "data.results",
  pageParam: "page",
  pageSizeParam: "limit",
  pageSize: 100,
  maxPages: 10,
};

test("LV4-06-01 exposes the five canonical Connection Center categories in locked order", () => {
  assert.deepEqual(
    CONNECTION_CENTER_CATEGORIES.map((category) => category.id),
    ["data_providers", "databases", "files", "ai_providers", "communications"],
  );
  assert.deepEqual(CONNECTOR_SETUP_STAGES, ["configure", "validate", "test", "discover", "save", "health"]);
});

test("LV4-06-02 validates secure provider endpoints and credential requirements", () => {
  assert.equal(validateDataProviderDraft(validDraft, { requireCredential: true }).valid, true);

  const insecureRemote = validateDataProviderDraft({ ...validDraft, endpoint: "http://api.example.com/v1" });
  assert.equal(insecureRemote.valid, false);
  assert.ok(insecureRemote.issues.some((issue) => issue.code === "insecure_remote_endpoint"));

  const localHttp = validateDataProviderDraft({ ...validDraft, endpoint: "http://127.0.0.1:8787/v1" });
  assert.equal(localHttp.valid, true);

  const embeddedCredential = validateDataProviderDraft({ ...validDraft, endpoint: "https://sample-user:sample-value@api.example.com/v1" });
  assert.equal(embeddedCredential.valid, false);
  assert.ok(embeddedCredential.issues.some((issue) => issue.code === "embedded_credentials"));

  const missingCredential = validateDataProviderDraft({ ...validDraft, credential: "" }, { requireCredential: true });
  assert.equal(missingCredential.valid, false);
  assert.ok(missingCredential.issues.some((issue) => issue.code === "credential_required"));
});

test("LV4-06-04 validates response paths and pagination bounds before persistence", () => {
  const unsafePath = validateDataProviderDraft({ ...validDraft, responsePath: "data.__proto__.polluted" });
  assert.equal(unsafePath.valid, false);
  assert.ok(unsafePath.issues.some(issue => issue.code === "invalid_response_path"));

  const invalidPageSize = validateDataProviderDraft({ ...validDraft, pageSize: 0 });
  assert.equal(invalidPageSize.valid, false);
  assert.ok(invalidPageSize.issues.some(issue => issue.code === "invalid_pagination"));

  const invalidMaxPages = validateDataProviderDraft({ ...validDraft, maxPages: 51 });
  assert.equal(invalidMaxPages.valid, false);
  assert.ok(invalidMaxPages.issues.some(issue => issue.code === "invalid_pagination"));
});

test("LV4-06-02/04 persisted provider payload carries discovery config but excludes the ephemeral credential", () => {
  const payload = buildPersistableDataProviderConnection(validDraft, "api_acme_market_data");
  assert.equal(payload.credentialRef, "api_acme_market_data");
  assert.equal(payload.config.endpoint, validDraft.endpoint);
  assert.equal(payload.config.authMode, "bearer");
  assert.equal(payload.config.method, "GET");
  assert.equal(payload.config.responsePath, "data.results");
  assert.equal(payload.config.pageParam, "page");
  assert.equal(payload.config.pageSizeParam, "limit");
  assert.equal(payload.config.pageSize, 100);
  assert.equal(payload.config.maxPages, 10);
  assert.equal("credential" in payload, false);
  assert.equal("credential" in payload.config, false);
  assert.equal(JSON.stringify(payload).includes(validDraft.credential), false);
});

test("LV4-06-02 no-auth connections never persist a credential reference", () => {
  const payload = buildPersistableDataProviderConnection(
    { ...validDraft, authMode: "none", credential: "unused-value" },
    "unused_reference",
  );
  assert.equal(payload.credentialRef, null);
});

test("LV4-06-02 only explicit healthy/live_verified tests count as verified", () => {
  assert.deepEqual(normalizeConnectionTestResult("healthy", "Connected"), {
    state: "verified",
    detail: "Connected",
    verified: true,
  });
  assert.equal(normalizeConnectionTestResult("live_verified", "Live").verified, true);
  assert.equal(normalizeConnectionTestResult("configured", "Saved but untested").verified, false);
  assert.equal(normalizeConnectionTestResult("degraded", "Vendor timeout").verified, false);
  assert.equal(normalizeConnectionTestResult("something_new", "Unknown state").state, "test_failed");
});

test("LV4-06-02 lifecycle does not permit discovery before verification", () => {
  assert.equal(canAdvanceConnectionSetup("ready_to_test", "test"), true);
  assert.equal(canAdvanceConnectionSetup("ready_to_test", "discover"), false);
  assert.equal(canAdvanceConnectionSetup("verified", "discover"), true);
  assert.equal(canAdvanceConnectionSetup("verified", "save"), true);
  assert.equal(canAdvanceConnectionSetup("testing", "save"), false);
});
