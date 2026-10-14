# LiOS V4 — P1 Provider & Credential Acceptance Checklist

> **Superseded in part (2026-10-02).** This document was written for the earlier LiOS-hosted model. Since GM-07 a customer install contacts no LiOS service: identity is local, entitlement is a vendor-signed licence file, billing/credits/webhooks are gone from the product, and there is one auth stack and one web bundle. Where this text describes a hosted control plane, Paddle billing, a credit wallet, `LIOS_CONTROL_PLANE_URL`, `/api/client/auth/{login,logout,me,register}` or `/client-terminal/`, read `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md` §40–§45 instead.

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07/SP-01–SP-07; S0–S10 validate, CP phases are historical. GM/TC/CA/P owners stay singular; P14 retains final release authority and privileged `exec.*` requires GM-11. V4/LV4 IDs remain frozen historical ledger identifiers.

> Phase objective: every credential/provider-gated row has either dated live evidence or a named blocker.  
> Truth source: `GET /api/operations/provider-acceptance`  
> CI contract: `npm run acceptance:providers`

## Status rules

- **[x] Acceptance-accounted** — the provider/transport is represented by the P1 ledger and cannot silently disappear.
- **[~] Live evidence pending** — code/contract exists, but approved credentials, consent, endpoint access, entitlement, or deployment evidence is still required.
- **[!] Code blocker** — the ledger identifies missing adapter/runtime work separately from an external credential blocker.
- A credential being present is **never** enough to mark a row verified.
- `verified` requires dated runtime evidence from a real provider/transport path.
- Secrets, tokens, passwords, webhook secrets, SMTP credentials and API keys are never returned by the acceptance API.
- Rows preserve the initial P1 accounting snapshot, not a fresh provider audit. Historical blockers below require current canonical-owner evidence before being promoted or repeated as current failures.

## AI / BYOAI

- [x] Anthropic — governed registry, model policy, attribution, live-call verification hook.
- [x] Google Gemini — governed registry, model policy, attribution, live-call verification hook.
- [x] OpenAI — governed registry, model policy, attribution, live-call verification hook.
- [x] Mistral AI — promoted from connector-only catalog entry to executable BYOAI provider; custom/current model override supported through `MISTRAL_MODEL`.
- [x] Groq — promoted from connector-only catalog entry to executable BYOAI provider; custom/current model override supported through `GROQ_MODEL`.
- [x] Together AI — promoted from connector-only catalog entry to executable BYOAI provider; custom/current model override supported through `TOGETHER_MODEL`.
- [x] OpenRouter — governed BYOAI provider.
- [x] xAI / Grok — governed BYOAI provider.
- [x] Generic OpenAI-compatible endpoint — endpoint + credential + configurable model.
- [x] Ollama — local BYOAI endpoint.
- [x] LM Studio — local OpenAI-compatible runtime.
- [x] Azure OpenAI — endpoint/deployment/key governed as one provider configuration.
- [~] Each provider becomes live-verified only after one governed completion succeeds in the target environment; failures are retained as dated degraded evidence.

## Market, fundamentals, macro, filings and crypto providers

Every built-in external connector is enumerated automatically from the connector registry.

### Keyed / licensed adapters

- [x] FRED.
- [x] Finnhub.
- [x] London Strategic Edge.
- [x] SimFin.
- [x] Financial Modeling Prep.
- [x] Alpha Vantage.
- [x] Polygon.
- [x] Twelve Data.
- [x] Tiingo.
- [x] EODHD.
- [x] Intrinio.
- [x] Nasdaq Data Link.
- [x] CoinMarketCap.
- [~] Live acceptance requires the approved provider key/license and a successful real adapter call in the target deployment.

### Public adapters

- [x] SEC EDGAR.
- [x] World Bank.
- [x] Bureau of Labor Statistics.
- [x] Yahoo Finance.
- [x] CoinGecko.
- [~] A public endpoint is still not marked verified until a live call succeeds and records a timestamp.

### Catalog/code blockers surfaced explicitly

Historical initial P1 snapshot:

- [!] IMF — recorded as catalogued with no adapter in the initial P1 build.
- [!] OECD — recorded as catalogued with no adapter in the initial P1 build.
- [!] ECB — recorded as catalogued with no adapter in the initial P1 build; not a claim about the current adapter.
- [!] RBI — recorded as catalogued with no adapter in the initial P1 build.
- [x] These are reported as code blockers, not falsely described as missing credentials.

## OpenBB (rejected and removed)

OpenBB has no approved LiOS use case. LIOS-P0-01 removed its sidecar, service, connector and package path; this provider acceptance checklist does not authorize reintroducing it. The active regression guard is `src/script/openbb_removal.test.mjs`.

## News

- [x] Google News RSS hydration records dated success/failure evidence.
- [x] Article/source attribution remains explicit.
- [~] Licensed commercial news-feed hydration remains a separate entitlement/provider blocker and is never implied by public RSS success.

## Communications

- [x] SMTP delivery records dated success/failure evidence after explicit confirmation.
- [x] Allow-listed HTTPS webhook delivery records dated success/failure evidence after explicit confirmation.

The following code/consent defects are the initial P1 snapshot, not newly observed failures:
- [!] Gmail OAuth — permission contract exists; OAuth/send/read adapter and user consent remain unwired.
- [!] Microsoft 365 / Graph — permission contract exists; OAuth/send/read adapter and tenant consent remain unwired.
- [!] IMAP — mailbox contract exists; read adapter and encrypted per-user credential custody remain unwired.
- [!] Slack — notification contract exists; OAuth/workspace delivery adapter remains unwired.
- [!] Teams — notification contract exists; Graph delivery/tenant-consent adapter remains unwired.
- [x] The acceptance ledger labels these as code/consent blockers rather than treating them as verified merely because a connection could be configured later.

## Billing / merchant lifecycle

Current access is owned by Home `/api/auth/*`, the local trial clock and imported vendor-signed licence verification. Identity, effective entitlement and owned data remain distinct; one auth stack and one build serve local and user-operated infrastructure. No Paddle key, checkout, webhook, credit wallet or hosted licence projection is required for customer runtime or public product acceptance.

The initial P1 merchant ledger recorded Paddle API/webhook/environment/price mappings, offline signature/replay/idempotency/projection tests and a pending real checkout/webhook lifecycle. Preserve those records as historical merchant evidence only; they do not authorize reinstating vendor billing in the product or establish current failures.

## Central visibility and CI

- [x] `GET /api/operations/provider-acceptance` exposes the redacted P1 ledger to internal readiness roles.
- [x] Operations Readiness panel displays verified/degraded/blocked provider rows, timestamps, blockers and next actions.
- [x] The recorded `npm run acceptance:providers` contract accounts unique rows/categories (including historical billing), evidence dates and redaction; historical row accounting is not a current billing prerequisite or live-provider certification.
- [x] The authoritative LiOS Quality Gate runs the P1 acceptance-accounting validator.
- [x] V4-28 commercial, AI, data and communications evidence references the P1 ledger.

## P1 exit

The recorded P1 exit criterion was an authoritative Quality Gate pass plus no unaccounted ledger rows. It is not SI completion or Shipping Point acceptance. Individual live rows require exact dated provider/transport evidence or explicit credential/consent/licensing/deployment/code gaps. Each applicable SP requires a real MSJ, packaged/target execution, no fake success, regression protection and exact commit/build/topology/check/outcome/limitation evidence. No accepted SP or current provider failure is inferred here.
