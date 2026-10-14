# LiOS V4 P5 Security & Privacy Runbook

> **Current deployment contract:** Desktop Local / LiOS Home is default; remote Home infrastructure is user-owned. Identity uses `/api/auth/*`, access uses local trial state or imported vendor-signed licence verification, and one auth stack/web bundle serves LiOS. No vendor customer runtime, billing service or client-terminal deployment is required.

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07 and SP-01–SP-07. S0–S10 are validation journeys; CP phases are historical. P7/P10 support qualification; P14 is final release authority. GM/TC/CA/P authorities remain singular. `V4-*`/`LV4-*` are frozen legacy evidence IDs.

**Phase:** P5 / V4-25  
**Scope:** repository-controlled security and privacy boundaries for LiOS Home, local/user-owned runtime, connectors, enterprise governance, diagnostics and release pipeline.

## 1. Security posture

LiOS is desktop-first and local-first. Customer files, private APIs, storage, databases and analytical work remain in the user's Home and governed source custody. Identity, ownership, subscription and effective entitlement are distinct; local trial or signed licence verification must not become a vendor-runtime dependency. Remote Home and enterprise IdP deployments are user-owned, not LiOS-operated customer services.

P5 controls remain subsystem evidence, not SI completion. Privileged interactive `exec.*` stays blocked until GM-11 exact-operation authority, sandbox and trust receipts are proven.

## 2. Permanent acceptance surfaces

- `GET /api/operations/security-acceptance` — internal read-only P5 evidence ledger.
- `npm run acceptance:security` — validates P5 evidence semantics and rejects accidental credential material.
- `npm run test:trust` — focused auth/CSRF/proxy/header/tenant/upload/security acceptance contracts.
- `npm run test:desktop` — desktop IPC, log-redaction, secret-custody, updater, workspace and packaged-runtime contracts.
- LIOS Quality Gate — remains authoritative and also runs production dependency audit, complete server/client offline tests, provider/desktop/production/security acceptance, live PostgreSQL RLS, Python deterministic tests, production build and release preflight.

A P5 ledger may truthfully remain `partial` because target-platform or independent evidence is external. That is not a CI failure. CI fails when the accounting contract is incomplete, contradictory, leaks credentials, or a repository-controlled security test fails.

## 3. Hosted network boundary

Historical heading retained for links; current scope is the user-owned network boundary, not a vendor runtime.

Private source execution belongs to the selected user-owned Home behind canonical connector permissions. The legacy hosted/internal generic-transport defense-in-depth baseline is recorded below; it does not prohibit user-owned remote Home or certify that topology:
- accepts only HTTP(S);
- reject URL-embedded credentials;
- require HTTPS for remote production transport;
- reject loopback, private, link-local, carrier-grade NAT, reserved and multicast destinations unless a reviewed deployment policy explicitly permits the private integration;
- resolve hostnames before the request and reject a destination when any resolved address is blocked;
- validate every redirect manually;
- cap redirects;
- never forward credentials to a different origin.

`LIOS_ALLOW_PRIVATE_CONNECTOR_NETWORKS=true` is a deployment-owned reviewed exception, never a model/user-request bypass. Home relocation must preserve source ACLs, secret custody, consent and narrower installed policies; remote source paths need topology-specific qualification.

## 4. Raw customer-file boundary

The former hosted `POST /api/client/datasets` denial is historical defense-in-depth evidence, not an active customer upload destination. Ingestion belongs to the selected user-owned Home; no vendor upload service is required.

For accepted local uploads:
- one file only;
- bounded size;
- extension allow-list;
- normalized filename;
- content-signature validation before spreadsheet/PDF parsing;
- text formats reject NUL/binary payloads.

Do not move raw customer parsing or exported bytes to a vendor service. Remote user-owned Home must qualify the same custody and parser boundaries.

## 5. Electron privilege boundary

Renderer:
- `nodeIntegration=false`;
- `contextIsolation=true`;
- sandbox enabled;
- drag/drop navigation disabled;
- child windows denied;
- top-level navigation restricted to the local LiOS renderer origin.

Preload exposes only reviewed methods. Every privileged IPC handler additionally verifies:
- sender is the active main-window `webContents`;
- sender is the top-level frame;
- sender origin is the current local LiOS server origin.

External URL opening accepts HTTPS only.

## 6. Session and proxy boundary

User-owned remote production Home behind a reverse proxy:
- defaults to exactly one trusted reverse-proxy hop;
- `TRUST_PROXY` accepts only `0/false` or an explicit hop count 1..5;
- rejects unbounded `true`;
- forces Secure session cookies;
- keeps HttpOnly/SameSite=Lax session policy;
- rotates sessions during login;
- keeps CSRF protection, with only the narrowly authenticated SAML ACS exception from P4.

The recorded server baseline defaults to `TRUST_PROXY=1`; qualify the actual user-owned topology and exact hop count rather than assuming a vendor-hosted deployment.

## 7. Browser headers

Production responses include HSTS, frame denial, MIME sniffing protection, permissions restrictions and CSP. CSP denies objects and framing, limits scripts to self, limits forms/base URI to self and constrains network/image/font/worker sources.

Electron installs its own local-runtime CSP because its legitimate connection target is the loopback server.

## 8. Secret and log handling

- Vault/list/readiness APIs never return stored secret values.
- Electron packaged secret custody uses `safeStorage` and verifies round-trip encryption.
- Desktop logs redact common Authorization/API-key/token/secret/password shapes.
- Launch logs never serialize full command-line arguments.
- Renderer error forwarding is redacted.
- Server 5xx logging stores request metadata, error class and a diagnostic fingerprint rather than serializing the raw error object.
- Remote diagnostics remain opt-in and allow-listed.

## 9. Tenant and enterprise boundary

Keep server-side role/organization authorization, tenant context and live PostgreSQL RLS attack tests mandatory where PostgreSQL is deployed. One Home auth authority owns identity; legacy audience-denial tests do not mandate dual authentication. P4 enterprise SSO, legal hold and AI-provider policy enforcement remain deployment-specific security dependencies.

## 10. Dependency and external-review boundary

The repository Quality Gate runs `npm run audit:prod`. It prefers standard `npm audit --omit=dev --audit-level=high`; if npm cannot produce a valid report because the registry audit fallback is unavailable, the wrapper retries npm's official Bulk Advisory endpoint directly using exact locked production versions. A high/critical finding—or inability to obtain advisory data—is a release blocker; do not suppress the gate to obtain green CI.

Repository tests cannot honestly replace:
- real signed/notarized macOS and signed Windows native-secret-custody evidence;
- dated deletion/export integrity receipts from the actual local or user-owned deployment, without vendor central custody;
- an independent dependency/application scan;
- an independent security review or penetration test.

These stay blocked in the P5 ledger until real evidence exists.

The 2026-09-24 zero-audit snapshot is dated evidence only, not a fresh scan. Source tests and autogenerated P14 security/rights categories do not replace independent review or Windows privacy qualification. SP acceptance requires a real MSJ, target execution, no fake success, regression protection and exact build/topology/check/outcome/limitation/truth-level evidence; this runbook accepts no SP.

The normal hardening gate defaults to `[self-hosted, Linux, lios-docker]`; manual hosted Linux or self-hosted macOS choices are explicit, not automatic fallbacks. Signed macOS arm64 release and Windows x64 release/clean-install jobs are separate qualification contexts. Source gate success cannot substitute for either signed target.

## 11. Rollback

If P5 causes a regression:
1. do not weaken tenant, secret, IPC, proxy, upload or connector protections to restore compatibility;
2. disable the affected optional connector/integration instead;
3. revert the smallest P5 commit responsible;
4. rerun focused tests;
5. rerun the full LIOS Quality Gate;
6. record any required exception as an explicit reviewed security decision.

Never lower the CI 6 GiB disk safety floor as part of a security/release recovery.

## 12. P5 exit condition

Repository-controlled P5 is complete only when:
- all focused security tests pass;
- `acceptance:security` passes;
- production dependency audit passes;
- full Quality Gate passes on the exact PR head;
- PR is current with `main` and mergeable;
- post-merge `main` Quality Gate passes.

External evidence remains a release gate, not fabricated repository completion.
