# LiOS Security Baseline

This is a point-in-time operational reference, not a substitute for the active release gates. Re-run the dependency audit against the exact checkout and lockfile being released; never carry findings forward without verification.

## Trust Boundaries

- Home owns one `/api/auth/*` stack, one API authority and one web build. Internal/client access is enforced by server/main-process role gates; legacy audience tests remain regression evidence, not separate production login/build authorities.
- Ownership binds the authenticated owner and organization independently of subscription. Cross-organization lookup must not reveal record existence; tenant-scoped persistence and PostgreSQL RLS apply where relevant.
- Private content enters AI-assisted workflows only through an approved, policy-governed application path. Recorded transmission consent does not grant source/tenant access; local-only restrictions cannot fall back to cloud.
- Desktop Local is default; remote Home/database/storage is user-owned. LiOS distribution and signed-licence issuance do not operate a customer intelligence/data runtime.

## Sessions and Transport

- Session cookies are `HttpOnly` and `SameSite=Lax`.
- Set `SESSION_COOKIE_SECURE=true` behind HTTPS. Local Electron uses loopback HTTP and therefore leaves the Secure flag off.
- User-owned remote deployments must provide a stable, secret `SESSION_SECRET`; local desktop installations persist a generated secret under the canonical DataRoot.
- Passwords use bcrypt, failed production logins lock the account temporarily, and security-sensitive actions emit audit events.

## Uploads and Parsing

- Uploads are authenticated and role-gated before Multer allocates file buffers.
- Only one allowlisted file is accepted per request. Client uploads are capped at 20 MiB; internal ingestion is capped at 25 MiB.
- Unsupported extensions are rejected before parsing. Size failures return `413` and malformed uploads return `400`.
- File extensions are an intake filter, not proof of content. Parsed output remains untrusted until schema validation and human review; PDF statement extraction is draft-only until a separate commit action.

## Provider and Network Safety

- Provider keys remain server-side and are never included in browser bundles or API responses.
- Provider failures must degrade the affected panel, not application startup.
- Quote WebSocket endpoints do not accept trade commands. Governed Gateway/device/run capabilities are distinct from quote transport; privileged interactive `exec.*` remains blocked pending proven GM-11 authority, sandbox and trust receipts. No brokerage execution or copy trading is in current scope.
- `src/server/egressPolicy.ts`, installed by server startup, guards server `fetch` and `node:http`/`node:https` request/get. Open/allowlist/offline policy and metadata blocking are source-integrated controls, not a whole-process network sandbox. Raw sockets, browser/native processes and database drivers need their own network/permission controls; connector SSRF and redirect validation remain separate requirements.
- Stored route manifests are inventories, not live hostile-request evidence. Release claims require exact-build execution and independent review where required.

## Dependency audit snapshot — 2026-09-24

The 2026-09-24 record reported zero findings in both full `npm audit` and `npm run audit:prod` against that remediation lockfile. It recorded the Remotion CLI/runtime family pinned together at `4.0.528` and the `drizzle-kit` compatibility alias using the root's patched `esbuild@0.28.2` override. These are historical dependency-tree observations, not current pins, a fresh scan, provider/API rights certification or packaged-artifact attestation. Re-run both audits against the exact release commit because registries and dependency trees change; high/critical production findings or unavailable advisory data block release.

## Known Build Diagnostic

That record traced Vite's visible warning that a PostCSS plugin did not pass a `from` path while processing Tailwind-generated in-memory declarations. It reported both then-current audience bundles completed and authored style URLs retained source metadata, against Tailwind 3.4.19 and Vite 7.3.1. This is not a current build result or an instruction to retain two production bundles; the current single-build contract and exact-release checks govern.
