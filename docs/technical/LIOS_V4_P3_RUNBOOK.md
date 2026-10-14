# LiOS V4 — P3 Production Operations & Rollback Runbook

> **Superseded in part (2026-10-02).** This document was written for the earlier LiOS-hosted model. Since GM-07 a customer install contacts no LiOS service: identity is local, entitlement is a vendor-signed licence file, billing/credits/webhooks are gone from the product, and there is one auth stack and one web bundle. Where this text describes a hosted control plane, Paddle billing, a credit wallet, `LIOS_CONTROL_PLANE_URL`, `/api/client/auth/{login,logout,me,register}` or `/client-terminal/`, read `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md` §40–§45 instead.

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07/SP-01–SP-07. S0–S10 validate; CP phases and V4/LV4 IDs are historical. GM/TC/CA/P owners remain singular; P14 retains final release authority and privileged `exec.*` requires GM-11.

This runbook covers distribution and supported local/user-operated operations. Home owns `/api/auth/*`, local identity/trial and signed licence verification, with one auth stack/build and no vendor customer runtime. It never requires or records secret values. Legacy P3 endpoint names below are historical evidence references, not proof of current availability.

## 1. Public distribution incident

Symptoms:
- website download points to missing/bad artifact;
- `latest-mac.yml` / `latest.yml` unreachable;
- customer updater cannot resolve feed.

Containment:
1. Stop publishing new website/download links.
2. Point website/download configuration back to the last known signed artifact.
3. Point the generic update feed back to the last known-good metadata/artifact set.
4. Verify published website/download/feed artifacts through the current release-owner path; the recorded P3 admin probe was `POST /api/admin/production-control/distribution/verify`, not a required vendor runtime endpoint.
5. Do not mark distribution restored until exact-artifact verification and the affected supported-target update/recovery journey succeed.
6. If a bad signed version reached customers, follow the P2 two-version update/rollback procedure.

Do not replace a signed artifact in-place while retaining the old checksum/version identity.

## 2. Merchant / Paddle incident

Current access/licence recovery replaces the historical merchant procedure:

1. Check Home identity/session separately from effective trial/licence entitlement and owned-work access.
2. Verify local trial timing or imported vendor-signed licence signature, trusted key, feature/time scope and any binding actually specified by the licence.
3. Do not manually mutate licence rows to match a payment or request vendor credentials/control-plane URLs.
4. Preserve sanitized validation code, licence identifier and exact build/time; use the supported import/re-auth/recovery path.
5. Confirm retained local work remains accessible according to the product contract before closing recovery.

Historical P3 merchant incidents involved Paddle checkout/price mappings, signed webhook projection and billing redirects. They are not current customer-runtime recovery steps or public-release prerequisites.

## 3. Diagnostics/privacy incident

Symptoms:
- unexpected diagnostic volume;
- privacy review concern;
- suspected unsafe diagnostic detail.

Immediate action:
1. Disable optional remote diagnostics in the affected Home/user-operated deployment and stop any consented upload.
2. Verify locally that no further diagnostic transmission occurs; historical `LIOS_TELEMETRY_ENABLED` and `/api/client/diagnostics/config` are not vendor-service prerequisites.
3. Confirm scope and legal-hold status before any metadata purge.
4. Use the supported confirmation-gated deletion path only; retain counts-only deletion evidence.
5. Review the allow-list and privacy/security approval.
6. Obtain fresh explicit time-bounded user consent before re-enabling remote support diagnostics.

Never request raw prompts, notes, uploaded data, report bytes or full crash stacks as a troubleshooting workaround.

## 4. Retention worker incident

Symptoms:
- no recent `retention_expiry` receipt;
- expired metadata accumulation.

Recovery:
1. Review current retention policy.
2. On the supported user-operated metadata store, use its verified purge path with explicit confirmation and legal-hold checks; the old `/api/admin/production-control/purge` is a historical reference.
3. Verify deletion counts and receipt ID.
4. Check sanitized logs on the actual user-owned process, not a vendor service.
5. Restore and exercise the applicable worker before closing; if unsupported, report that limitation rather than fabricate scheduled recovery.

Never run hosted retention logic against the customer desktop/local BYOD workspace.

## 5. Organization deletion request

1. Confirm the authorized organization and deletion scope.
2. Export/review only receipt metadata needed for audit.
3. Check legal hold, then use the supported user-operated operational-metadata deletion path with reason + confirmation.
4. Retain the deletion receipt; a blocked hold must delete nothing.
5. This operation covers only its declared metadata scope. Home/BYOD/export files remain user-custodied and need their separately authorized local deletion workflow; no vendor purge or central receipt is required.

## 6. Export custody discrepancy

If local export integrity or an optional user-operated receipt does not match:
1. Keep file bytes local; never upload them to a vendor control plane for diagnosis.
2. Recompute SHA-256 locally.
3. Compare local byte size/hash to the receipt.
4. Generate a new export if needed.
5. Where supported, tombstone stale user-operated receipt metadata only after authorization/legal-hold checks; central custody is not mandatory.

## 7. Operations notification outage

1. Core LiOS service remains available; notification delivery is non-authoritative.
2. Fix SMTP/destination configuration.
3. Run the explicit production notification test.
4. Keep the feature blocked until a dated successful delivery exists.

## 8. Evidence required after rollback/recovery

Record only:
- release/commit identifier;
- timestamps;
- endpoint/test names;
- response status;
- deletion/relay/receipt identifiers;
- affected service category;
- pass/fail and remediation reference.
- exact target environment/topology and bounded recovery journey;
- packaged/target evidence where applicable, known limitations and remaining dependency;
- applicable SP/MSJ and regression evidence for previously accepted behavior, without inferring acceptance. SP-01–SP-07 also require a real journey, no fake success and exact evidence under P14 release authority.

Never place secrets, API keys, passwords, raw client data, full crash stacks or exported files in the evidence record.
