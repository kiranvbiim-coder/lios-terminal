# P5: GLEIF legal-entity reference enrichment (read-only)

**Scope:** additive source adapter to the existing P5 Global Instrument Master and /api/finance route authority. No second security registry, no external Python runtime, no proprietary data copy, no central LiOS compute, and no license/credential cost.

- Official source: https://www.gleif.org/en/lei-data/gleif-api
- LEI data rights: CC0-1.0 as stated at https://www.gleif.org/en/meta/lei-data-terms-of-use
- Added code: `src/server/gleifEntityReference.ts`
- Route: `GET /api/finance/entities/gleif?lei=5493001KJTIIGC8Y1R12` **OR** `GET /api/finance/entities/gleif?name=Example%20Corp`
- Requires authenticated LiOS session through existing `/api/finance/` middleware.
- Returned `records`: validated LEI, legal name, jurisdiction, address country, entity status, LEI registration status, update date, exact public source URL, retrievedAt, explicit provisional/reference-only disposition.
- LEI lookup returns `found` or `not_found`; legal-name lookup returns `candidates`, never silently assigns a corporate ID. No ticker, security ID, quote, LEI-to-ISIN relation, ultimate parent or beneficial owner is guessed.
- Fair-access: max 8 source records, max 512 KiB response, 10-second deadline, fixed HTTPS provider host, correct 400/429/502 conditions. No user-controlled URL, no credential forwarding, and no passive background lookups.
- Offline synthetic tests: LEI ISO17442 mod-97, direct exact LEI and name filter, source status, 404, 429, mismatch, excessive page and payload. Native installed journey and live GLEIF behavior **NOT_VERIFIED** yet.

**Why now?** The 303k+ instrument-universe PR #217 expands *listed references*. GLEIF adds corporate/legal-entity *depth* without inaccurately expanding that security count. Later P5 can introduce explicit reviewed match proposals from LEI-to-ISIN, LEI-to-BIC, parent-child, and corporate action source links with evidence and human review; that integration is not performed by this source adapter.

**Related P11 donor priorities:** `docs/technical/P11_OSS_CANDIDATE_MATRIX.md` section 7. OpenBB V5's newly Apache-2.0 license is a review trigger, not an automatic code import, and no OpenBB runtime was changed in this PR.

**Acceptance:** source typecheck, route-manifest gate, tests, commercial-source review, and installed app output must pass before claiming usable shipping capability. Keep this PR independent of #217 except for ordinary route-manifest reconciliation after the first merged PR.
