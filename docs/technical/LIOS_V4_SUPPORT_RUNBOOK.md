# LiOS V4 support runbook

> **Superseded in part (2026-10-02).** This document was written for the earlier LiOS-hosted model. Since GM-07 a customer install contacts no LiOS service: identity is local, entitlement is a vendor-signed licence file, billing/credits/webhooks are gone from the product, and there is one auth stack and one web bundle. Where this text describes a hosted control plane, Paddle billing, a credit wallet, `LIOS_CONTROL_PLANE_URL`, `/api/client/auth/{login,logout,me,register}` or `/client-terminal/`, read `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md` §40–§45 instead.

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07/SP-01–SP-07. S0–S10 validate; CP phases and V4/LV4 IDs remain historical. GM/TC/CA/P owners stay singular; P14 retains final release authority and privileged `exec.*` requires GM-11.

## First response

1. Capture the correlation ID, UTC timestamp, account/organization ID, and
   affected surface. Do not request a password, API key, raw export, or client
   dataset in chat.
2. Check the selected Home/user-operated runtime's supported readiness and
   connector/sidecar health surfaces. `/api/operations/readiness` is the recorded
   legacy reference, not a required vendor endpoint. Preserve sanitized status
   and evidence paths; report an unavailable surface explicitly.
3. Reproduce in a non-production workspace where possible. Record the exact
   route/action and whether the result is unavailable, degraded, or failed.

## Safe diagnostic bundle

Support mode requires explicit, time-bounded consent. Diagnostic bundles are
   redacted before leaving the workspace and include only system metadata,
   connector health, configuration shape, and recent sanitized errors.

Never attach credential-vault files, database files, browser storage, raw
   client exports, model prompts, or private keys. If a provider is needed,
   request the provider request ID rather than its secret.

## Recovery order

1. Verify startup readiness and migration status.
2. Retry only idempotent provider actions after the bounded backoff window.
3. Restore the last verified workspace backup if local state is damaged.
4. For access/entitlement issues, check Home `/api/auth/*` identity/session,
   local trial timing and imported vendor-signed licence signature/time/feature
   scope separately from owned-work custody. Preserve sanitized validation
   codes/licence identifier; do not manually mutate a licence row or require
   Paddle events, control-plane URLs/projections or a vendor audit trail.
5. Escalate blockers to the canonical owner with exact readiness item, build,
   target/topology, observed result and next action. One auth stack/build serves
   local and supported user-owned infrastructure; no vendor customer runtime.
6. Verify recovered state by reopening retained work on the actual target.
   Shipping Point recovery requires the affected real MSJ, packaged/target
   evidence, no fake success, regression protection and exact evidence including
   limitations. This runbook does not accept any SP-01–SP-07 milestone.
