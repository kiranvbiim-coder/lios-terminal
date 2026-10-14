# LIOS Security Test Matrix

**Current deployment scope:** Desktop Local / LiOS Home is default; remote Home is user/organization-owned, never a LiOS-operated customer runtime. One web build, one Home-owned `/api/auth/*` stack and one API authority retain server/main-process role gates. Distribution and signed-licence issuance are separate from runtime. Legacy audience/control-plane test names below identify regression evidence, not instructions to restore removed services.

A row is repository-complete only when a deterministic test or permanent Quality Gate step proves the repository-controlled behavior. External evidence is labeled separately.

| Boundary | Expected result | Evidence |
|---|---|---|
| Internal role -> client-only surface | deny | auth role/audience tests |
| Client role -> internal terminal surface | deny | auth role/audience tests |
| Login session fixation | old session discarded | auth session-rotation test |
| Cross-origin authenticated mutation without CSRF | 403 | CSRF tests |
| Enterprise SAML ACS exception | only exact numeric ACS route bypasses ordinary CSRF | CSRF + enterprise SAML tests |
| Legacy client device fingerprint in production | ignored | auth/control-plane hardening tests |
| Cross-tenant user-owned DB access | deny at application + PostgreSQL RLS layer where applicable | tenant tests + live PostgreSQL RLS attack plan |
| Raw customer dataset upload outside an authorized user-owned Home intake | reject before multipart parsing | privacy boundary test; authorized local/user-owned intake tested separately |
| Spoofed spreadsheet/text upload | reject before parser | upload-policy tests |
| Path/control characters in uploaded filename | normalize | upload-policy tests |
| Private API/cloud-storage/database BYOD outside authorized user-owned runtime/source scope | reject before user-source network/DB/file access; explicitly selected private infrastructure is not blanket-denied | runtime/source guard + connector/database/privacy tests |
| Generic untrusted API -> loopback/private/reserved address | reject before fetch; approved private connectors use their own governed authority | API connector SSRF tests |
| Generic untrusted API redirect -> private address | reject redirect | API connector SSRF tests |
| Connector credential redirect to another origin | reject | API connector redirect test |
| Unlimited redirect chain | reject | connector redirect cap |
| User-owned remote Home reverse-proxy spoofing exposure | bounded explicit hop count | runtime-security tests |
| User-owned remote Home session transport | HTTPS and Secure cookie required; local Electron loopback HTTP is distinct | runtime-security tests |
| Production Home clickjacking/object/script relaxation | restrictive production headers/CSP | security-header test |
| Foreign Electron webContents -> privileged IPC | reject | desktop IPC tests |
| Electron subframe -> privileged IPC | reject | desktop IPC tests |
| Electron renderer child window/foreign navigation | deny | main-process source + desktop qualification |
| Desktop log contains common token/API-key/password form | redact | desktop log-redaction tests |
| Home 5xx response exposes stack/internal error | generic public error + request ID | server error contract |
| Home 5xx server log serializes raw Error | no; fingerprint/class only | P5 index contract/source |
| Credential list/readiness endpoint returns secret | never | vault/enterprise/provider contracts |
| BYOAI enterprise policy bypass | deny at actual provider invocation boundary | P4 enterprise AI policy tests |
| Legal hold vs purge/export deletion | hold wins | P4 enterprise/production-control tests |
| Dependency high/critical production advisory or unavailable advisory data | fail CI | tested `npm run audit:prod` wrapper: standard npm audit + fail-closed official Bulk Advisory fallback |
| Signed target-platform native secret custody | real artifact required | external P2/P5 evidence |
| Production deletion/export receipt | dated deployment receipt required | external P3/P5 evidence |
| Independent application/dependency scan | independent report required | external |
| Independent security review / penetration test | independent report required | external |
| Home server fetch and node:http(s) request/get egress | enforce configured open/allowlist/offline policy and metadata blocking | `src/server/egressPolicy.ts` + deterministic policy tests; source integration is not fresh target evidence |
| Raw sockets, browser/native processes and DB-driver network access | separate permission/network isolation controls required; server HTTP guard alone is insufficient | subsystem source review + target security evidence |
| Privileged interactive exec.* | blocked until GM-11 exact-operation authority, sandbox and trust receipts are proven | GM-11 authority and real governed execution journey |

## Permanent gate rule

Security is not established by UI hiding or by a document. The PR head must pass the authoritative LIOS Quality Gate, including live PostgreSQL tenant/RLS tests. If a new client-data or privileged route is introduced, add both an authorized positive test and an unauthorized/hostile negative test.

Do not turn an external evidence row green by configuration guess or a unit-test substitute.

A stored route manifest, including `reachableBy` and `unprobed` fields, is an inventory snapshot, not proof of current route exposure, live hostile-request results or release-bound security. Historical scan/test snapshots remain dated observations. SP-01–SP-07 require the real MSJ, applicable packaged/target execution, no fake success, regression protection and exact evidence defined in `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`; no row here establishes an accepted Shipping Point.
