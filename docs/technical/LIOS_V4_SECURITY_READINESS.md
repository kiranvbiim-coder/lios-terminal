# LiOS V4 Security Readiness

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07 and SP-01–SP-07. S0–S10 are validation journeys; CP phases are historical. P7/P10 support qualification; P14 is final release authority. Existing GM/TC/CA/P owners remain singular. `V4-*`/`LV4-*` are frozen legacy evidence IDs.

**Historical repository evidence:** 2026-09-20 — P5 merged to `main` (`5584706`). This is not the date of this reconciliation or a fresh scan. Controls below describe recorded source baselines; independent scan/review and exact-release evidence remain external.

Desktop Local / LiOS Home owns identity through `/api/auth/*`, local trial or imported vendor-signed licence verification, and one auth stack/web bundle. No vendor customer runtime, billing provider, control-plane URL or separate client-terminal deployment is required. User-owned remote Home is permitted but needs actual-topology qualification. Privileged interactive `exec.*` remains blocked pending proven GM-11 authority.

## Repository-controlled controls

### Desktop and local boundary
- Electron renderer runs sandboxed with Node disabled and context isolation enabled.
- Child windows and foreign top-level navigation are denied.
- Privileged IPC authenticates the active top-level LiOS renderer before file backup/restore, workspace metadata or external URL actions.
- Preload exposes a narrow reviewed bridge.
- Packaged secret custody binds to Electron `safeStorage`, persists the encrypted master key with restrictive local permissions where supported and performs a round-trip self-test.
- Desktop file/renderer logs pass through secret redaction; launch logs do not serialize full argv.
- Updater and workspace-recovery integrity remain covered by desktop/release tests.

### Local-first customer data boundary
- The former hosted raw-upload rejection is historical defense-in-depth evidence, not an active vendor ingestion requirement.
- Private API, cloud-storage and database execution belongs to the selected user-owned Home behind connector permissions; remote Home is not prohibited or certified by the legacy local-desktop checks.
- Local file ingestion is size/count bounded, filename-normalized and content-signature checked before parsing.
- Export bytes and integrity receipts remain in user-owned custody, not a mandatory central service.

### Hosted network/session boundary
Historical heading retained for links; the current boundary is user-owned Home, not a vendor runtime.
- Remote production transport requires HTTPS; qualify actual Home/source topology rather than assuming a LiOS-hosted server.
- Generic connector defenses reject local/private/link-local/reserved destinations after DNS resolution unless a reviewed deployment policy permits the private integration.
- Redirects are followed manually, revalidated and capped.
- Credentials are never forwarded across connector origins.
- User-owned remote production session cookies are Secure by default.
- Reverse-proxy trust is bounded to an explicit hop count; production defaults to one hop rather than trusting arbitrary forwarding headers.
- Production browser responses carry HSTS and restrictive CSP/security headers.

### Identity, authorization and tenants
- One Home auth authority enforces role/organization denial; legacy internal/client audience tests do not mandate dual authentication.
- Authentication rotates sessions.
- Cookie-authenticated mutation routes are CSRF protected; P4 SAML POST has a narrow authenticated ACS exception.
- Device binding must follow signed licence contents where specified; legacy client-supplied fingerprints are not a new identity authority.
- Tenant scope is enforced in application code and backed by live PostgreSQL RLS attack-plan tests in the Quality Gate.
- P4 enterprise SSO, AI policy projection, legal hold and private-deployment verification remain fail-closed dependencies.

### Secrets, diagnostics and privacy
- Credentials remain in encrypted/local or organization-scoped vault custody.
- Credential-list/readiness APIs return metadata, not secret values.
- Server 5xx logging stores bounded metadata plus a fingerprint, not the raw error object.
- Remote diagnostics are opt-in, redacted and allow-listed.
- Retention/deletion receipts, export integrity and enterprise legal hold must be qualified in the actual local/user-owned deployment; no vendor custody service is required.

### Supply chain
- The authoritative Quality Gate runs `npm run audit:prod`, preferring standard `npm audit --omit=dev --audit-level=high` and failing closed through npm's official Bulk Advisory API when npm's retiring quick-audit fallback cannot produce a valid report.
- High/critical production dependency findings are not silently ignored.
- Build, test, RLS, deterministic-engine and release-preflight controls remain part of the same gate.

The 2026-09-24 zero-audit snapshot is dated evidence, not a fresh advisory result. Source checks and autogenerated P14 security/rights evidence are not independent review or all-platform privacy proof. Signed macOS arm64 and Windows x64 qualification independently requires mandatory managed sidecars, native secrets, signatures (including deep strict macOS codesign before/after real Python execution and installed self-test, no post-launch re-signing; Windows installer and sidecar Authenticode), install/update/rollback and target accessibility. Self-test resource/time ceilings are not interactive performance measurements.

The automatic hardening context defaults to `[self-hosted, Linux, lios-docker]`, with explicit manual runner choices and no implicit hosted fallback. Signed macOS build uses approved self-hosted macOS arm64 and clean install hosted `macos-15`; Windows release and clean install use separate `windows-latest` jobs.

## Machine-readable accounting

`GET /api/operations/security-acceptance` exposes the internal read-only P5 ledger.

`npm run acceptance:security` verifies:
- unique required controls;
- evidence on verified rows;
- named blockers on blocked rows;
- a next action for every row;
- no obvious credential material in serialized acceptance output.

Expected external-only rows do not make CI red; lying about them or omitting them does.

## External gates

The following remain external and must not be marked complete from source alone:

1. signed/notarized macOS and signed Windows packaged evidence that native secret custody succeeds on the actual release artifacts;
2. dated deletion and export-integrity receipts from the actual user-owned deployment, preserving legal hold and without vendor central custody;
3. an approved independent dependency/application security scan and remediation disposition;
4. an independent security review or penetration test and disposition of material findings;
5. any jurisdiction-specific legal/compliance determination required for regulated deployment.

## Source of truth

Operational procedure and rollback: `docs/technical/LIOS_V4_P5_SECURITY_RUNBOOK.md`.

Permanent regression inventory: `docs/technical/SECURITY_TEST_MATRIX.md`.

Final execution is governed by the SI plan and mandatory Shipping Point contract; P14 retains final release authority with P7 supporting evidence and exact tag/version binding. Each SP requires a real MSJ, applicable target execution, no fake success, regression protection and exact build/environment/topology/check/outcome/limitation/truth-level evidence. No SP acceptance follows from this historical ledger, a source pass or a workflow definition. Historical V4 planning is not an active program.
