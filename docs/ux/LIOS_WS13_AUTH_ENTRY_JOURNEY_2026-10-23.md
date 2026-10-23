# WS-13 — Authentication and First Entry (truthful, recoverable, Chat-first)

**Date:** 2026-10-23. **Plan:** 65-workstream UX plan [PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119); central tracking [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Integration dependency:** [PR #99](https://github.com/kiranvbiim-coder/lios-terminal/pull/99) already owns universal Chat-first, public-facing Product Preview language, and the AuthenticatedNavigation sidebar. Do **not** duplicate or revert those changes.

## Verified existing code

- `App.tsx` already restores its session from `/api/auth/me` via `restoreSession` before showing an authenticated `Terminal`. The session helper **only** treats 401 as signed out; 403, rate limits, service errors and invalid success responses remain recoverable errors. It already uses a 15s deadline and a sanitized cancellation signal. Password-change-required and sign-out fail-closed flows already exist. On authenticated entry, the original `AppRouter` owns one Terminal/Chat route; the UI does not require completing a connection wizard or choosing a finance domain.
- Public Product Preview messaging is **owned by PR #99**. Main still contains finance-only claims (e.g. Project required for every analysis) and inconsistent advertised trial durations. WS-13 does not attempt to merge or overwrite that already-open feature PR. Review public pricing, subscription rights and trial duration against *server entitlement truth*, not against either the older 14-day preview or older 7-day Login copy.
- `Login.tsx` prior to this change displayed fixed 300/400/500ms simulated handshakes and 10/30/60/90/100% progress even though real auth and session verification were independent of the animation. It sometimes surfaced raw backend `data.error`, SSO approval errors and registration failures directly. A fast double Enter/click could send duplicate POSTs. If the initial `/api/auth/bootstrap/status` fetch failed, it fabricated `setupRequired: false` and continued to Login rather than knowing whether administrator bootstrap was mandatory. It also delayed successful sign-in by another arbitrary half-second.
- Server-based SSO device approval was already implemented. Keep its actual user-approved external flow, deadline, server polling and explicit `/api/auth/me` verification, rather than inventing a browser-only authorization fallback.

## Implemented change

1. `src/client/src/lib/authEntryState.ts`: small pure allow-listed server-reason → safe localized denial messages; distinct wrong credentials, rate limit, access policy, registration conflict and service outage without surfacing arbitrary backend body. `verifiedEntrySession` calls existing hardened `restoreSession` on `/api/auth/me` and never grants entry from a POST acknowledgement alone. `safeSsoVerificationUrl` refuses non-HTTPS URL schemes or URLs with embedded credentials. `authEntryFetch` bounds auth requests to a 15s header response deadline, aborting transport on timeout.
2. `Login.tsx` now reports **only observed network stages**: requesting credentials or SSO approval, server acknowledgement, then fresh verified session. Simulated handshake delays and unearned numerical progress have been removed. Sign-in, register and SSO all use one synchronous `authPending` ref, so duplicate rapid actions cannot issue parallel requests. Entry is conditioned on the component still being mounted, preventing an abandoned pending sign-in or SSO approval from opening an unexpected workspace.
3. Unknown, malformed or unreachable first-run `/api/auth/bootstrap/status` no longer produces fake `setupRequired:false`; the view is explicitly unavailable with a real Retry. A verified `setupRequired:true` still opens existing `FirstRunAdminSetup`; no bootstrap token, policy or authorization change. Login does not guarantee a 7-day Pro plan: copy says trial eligibility comes from the secure server; entitlement/pricing work must be reviewed with PR #99.
4. No edited files from #99: `PublicProductPreview.tsx` and `AuthenticatedNavigation.tsx` remain their owner's responsibility. The original `App.tsx` and `sessionLifecycle.ts` are unchanged; their server-first protection remains authoritative.

## Tests and acceptance

- **Nine executable pure cases:** `src/client/src/lib/authEntryState.test.ts`. Covers authentic server identity gate, 401 vs 403/5xx, allow-listed error copy, HTTPS device SSO, request timeout, absence of private server data in error messages.
- **Eight source integration cases:** `src/script/validate_ws13_auth_entry.test.mjs`. Checks original entry routing/restoration, unknown-bootstrap fail-closed, no simulated progress, fresh session requirement on all three sign-in paths, and original PR #99 ownership.
- Existing `src/client/src/lib/sessionLifecycle.test.ts` tests the timeout, aborted request and logout guarantees. Run unchanged as a regression test. Existing PR #99 source tests must be rechecked when that PR is integrated.

From `src/` at **exact reviewed head**:

```bash
node --import tsx --test client/src/lib/authEntryState.test.ts client/src/lib/sessionLifecycle.test.ts script/validate_ws13_auth_entry.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Acceptance | Status |
| --- | --- |
| Auth code and 17 new tests committed in draft PR | IN_PR |
| Exact-head hosted CI, TypeScript check and full repo suite | PENDING |
| Real 401 vs temporary 403/5xx; malformed bootstrap; SSO expiration | NOT_RUN |
| Sign-in with delayed/denied server and rapid Enter/clicks | NOT_RUN |
| Fresh user reaches universal Chat without required connector setup | NOT_RUN |
| 200% zoom, keyboard-only input, errors, retry and password change | NOT_RUN |
| VoiceOver/Narrator and installed macOS/Windows sign-in/restore | NOT_RUN |
| Pricing/trial/public copy merged from #99 and checked against entitlements | PENDING |
| Independent approval, merge to protected main, native release | PENDING |

**Do not conflate source-contract checks with real server, browser, security penetration or native accessibility acceptance.** Final walkthrough needs exact commit/OS, HTTP status and realm, remote session vs local sign-in, trial and password-change state, and screenshots with fake demo identities only; never publish credentials, tokens, production connection payloads or private data. It must verify public site copy matches the actual subscription/entitlement API and the original Chat route remains universal.

**Next:** WS-14 — first-use product guidance, without imposing a mandatory setup wizard.
