import assert from "node:assert/strict";
import test from "node:test";
import { describeLicenseAccess, licenseEntryProblem, needsFirstRunChoice, readOnlyBannerText, type LicenseAccess } from "./licenseAccess";

const base: LicenseAccess = { mode: "full", reason: "trial_active", trialEndsAt: null, licenseExpiresAt: null, daysLeft: null, canStartTrial: false, isOwner: true };

test("read-only banner explains each way access ends and stays silent while work is allowed", () => {
  assert.equal(readOnlyBannerText(undefined), null);
  assert.equal(readOnlyBannerText(base), null);
  assert.equal(readOnlyBannerText({ ...base, mode: "full", reason: "license_valid" }), null);
  assert.match(readOnlyBannerText({ ...base, mode: "read_only", reason: "trial_expired" }) ?? "", /Read-only.*trial has ended.*license key/);
  assert.match(readOnlyBannerText({ ...base, mode: "read_only", reason: "license_expired" }) ?? "", /Read-only.*license key has expired/);
  assert.match(readOnlyBannerText({ ...base, mode: "read_only", reason: "trial_not_started" }) ?? "", /Start 7-day trial/);
});

test("first-run choice follows trial activation permission, independently of Home ownership", () => {
  const pending: LicenseAccess = { ...base, mode: "read_only", reason: "trial_not_started", canStartTrial: true };
  assert.equal(needsFirstRunChoice(pending), true);
  assert.equal(needsFirstRunChoice({ ...pending, isOwner: false }), true);
  assert.equal(needsFirstRunChoice({ ...pending, canStartTrial: false }), false);
  assert.equal(needsFirstRunChoice({ ...pending, reason: "trial_expired" }), false);
  assert.equal(needsFirstRunChoice(undefined), false);
});

test("settings status states what is in force and the days left", () => {
  assert.match(describeLicenseAccess({ ...base, reason: "trial_active", trialEndsAt: "2030-01-08T00:00:00Z", daysLeft: 7 }), /Free trial until .*\(7 days left\)/);
  assert.match(describeLicenseAccess({ ...base, reason: "license_valid", licenseExpiresAt: "2030-01-08T00:00:00Z", daysLeft: 1 }), /Licensed until .*\(1 day left\)/);
  assert.match(describeLicenseAccess({ ...base, mode: "read_only", reason: "trial_expired" }), /Read-only/);
});

test("the paste box rejects obviously wrong input before sending and lets real keys through", () => {
  assert.match(licenseEntryProblem("   ") ?? "", /Paste your license key/);
  assert.match(licenseEntryProblem("hello world") ?? "", /starts with LIOS1-/);
  assert.match(licenseEntryProblem(`LIOS1-${"A".repeat(70_000)}`) ?? "", /too long/);
  assert.equal(licenseEntryProblem("\n LIOS1-abcDEF_-123 \n"), null);
  assert.equal(licenseEntryProblem('{"format":"lios-license/1"}'), null);
});
