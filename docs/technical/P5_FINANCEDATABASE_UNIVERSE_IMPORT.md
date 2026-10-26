# P5 | Optional 100,000+ instrument discovery import

**Canonical owner:** existing P5 Global Instrument Master / `instrumentSearchIndexStore`. **Purpose:** expand *provisional reference discovery*, not invent a new security master or imply market-data entitlement.

## Donor and licensing record

- Donor: [JerBouma/FinanceDatabase](https://github.com/JerBouma/FinanceDatabase).
- Snapshot pin: `3815eb341c7aa7bfae4a720744093e75528b6099` (2026-10-25).
- Data paths: `database/equities/*.csv`, `database/etfs/*.csv`; optional `funds/*.csv`, `indices.csv`, `currencies.csv`, `cryptos.csv`, `moneymarkets.csv`.
- Donor repository license: MIT. Copyright © Jeroen Bouma; preserve upstream notices if licensed code or data is distributed. **Important:** repo license does not independently certify every third-party exchange source's commercial redistribution rights.
- Disposition: ADAPT / GENERALIZE (read CSV listings and provenance; use native LiOS canonical candidate adapter + index). No donor runtime installed, no additional database, no new Python dependency, no copy of donor code in product.
- No source CSVs, converted snapshots, API keys or donor Git history are committed or embedded in GitHub Actions artifacts.
- The original legacy dataset and its separate private catalog recovery work live in #215; this import does **not** move those bytes into public Git.

## User-owned import

From the public repo's `src/` directory:

```bash
# Source-worktree development: Git + Node are sufficient. Uses a pinned,
# public source commit and an ephemeral sparse clone. No paid API keys.
npm run data:universe:import

# Verify checksums, source counts and venue identities without downloading:
npm run data:universe:verify

# Roll back to the previous validated local import, when one exists:
npm run data:universe:rollback

# Optional subset, only for development or deliberate partial coverage:
node script/import_financedatabase.cjs --categories equities,etfs --min 100000

# Offline: import from a locally available donor checkout instead:
node script/import_financedatabase.cjs --from-dir /path/to/FinanceDatabase
```

Default imports **all seven source asset classes** and enforces a strict floor of **300,000** imported venue-and-currency-qualified reference records against the pinned donor revision (upstream published total: **303,092**). If validation/dedup removes too many to meet that floor, the install fails rather than fabricating coverage. For a local test fixture use `--min 1`; that is test-only evidence, not production coverage.

Output uses the existing LiOS **user-owned Data Root**, not `server/data`: `<LIOS_DATA_ROOT>/instrument-catalogs/financedatabase_universe.json` and `financedatabase_manifest.json`. Every install writes a checksum-bound manifest. Previous installed versions are retained for an explicit rollback. New statuses are available through `/api/finance/directory/status` and `/api/finance/directory/facets`. In development the existing default data root is `src/data/`, ignored by public Git. Production uses the user's configured/persistent data root. The importer writes atomically, records commit/time/file checksums, source counts, skipped rows and duplicates, and does not silently claim that 100k *unique issuers* exist.

Restart the local LiOS Home after importing so its existing in-process index cache can load the new dataset. The optional adapter returns empty when the user has not imported anything, leaving other provider/canonical paths unaffected.

## Record contract and coverage truth

- Dedup key is **asset class + ticker + MIC/exchange**, never raw ticker alone; distinct venue listings remain separate, and same-name entities are never silently given canonical IDs.
- Source `symbol`, `name`, exchange/MIC, available ISIN/FIGI family, and delisted status are retained where supplied. Donor classification fields (sector, industry, category, category group, family, country name and market-cap *tier*) are stored as descriptive source metadata; they are not price observations.
- `country` strings are not converted to ISO country codes by guesswork; missing ISO country is null.
- Every result remains `canonical:false` until linked through the current P5 persisted identifier resolution. Delisted rows remain available for the existing historical search option, not current-default search.
- **Market data remains independent:** a discoverable ticker does not guarantee quotes, fundamentals, price history, dividend events, backtests, matching identifiers or provider entitlements. Report source and missing data honestly.
- Source may include holdings, duplicate issuers, cross-listings, inactive symbols, and indices; LiOS must distinguish total rows, unique listing keys, linked legal entities, currently active instruments and live-data-enabled instruments.
- FinanceDatabase provides an optional hosted MCP search endpoint, but this import uses local files; do not add an unapproved remote dependency or second MCP authority.

## Remaining integrated acceptance

1. Run `npm run test:data-universe && npm run check && npm run check:routes` and the default offline gate. Tests in this PR are synthetic; no honest installed-coverage count is available before the import is executed in a real checkout.
2. On the owner machine run the actual pinned import, inspect accepted/duplicate/skipped counts and compare with the donor snapshot. Confirm **100,000+ nonduplicate venue-qualified source rows**.
3. Reconcile overlapping private legacy/provider catalogs and real CIK/ISIN/FIGI mappings. Symbol-only cross-source dedup must not erase exchange variants or reuse a symbol as legal identity.
4. **Source implementation completed in PR #217:** directory, autocomplete, filter facets and installed coverage status now consume one P5-read directory adapter; old route hardcoded data and 20 hard-coded mutual-fund rows have been removed. Native UI test and installed-package smoke remain unrun.
5. Run the newly added gated `LIOS_REAL_DATA_BENCHMARK_ENTITLED=1 npm run benchmark:instrument-search:300k` on the **real user-installed snapshot**. It measures index startup, directory scans, p95 latency and RSS with explicit SLOs; inspect cold restart and native macOS/Windows behavior as separate V3/V4 acceptance. Tests with synthetic rows do not qualify this.
6. Review upstream source-by-source commercial redistribution before any installer bundles these catalog bytes. User-local import is not blanket redistribution permission.
7. Add data-source freshness/status and a user-initiated update/rollback journey using the existing governed connector/data-root mechanisms; no silent periodic download or remote LiOS compute.

**Release rule:** The dataset is intentionally absent from `src/package.json` `extraResources`, because it lives under user-owned Data Root. Do not copy it into `server/data` for packaging without rights approval. This is P5 source integration, not SP/P14 acceptance.

## Donor-published baseline at pinned source commit

| Asset class | Source records |
|---|---:|
| Equities | 121,519 |
| ETFs | 31,976 |
| Funds | 57,761 |
| Indices | 82,360 |
| Currencies | 2,516 |
| Cryptocurrencies | 5,735 |
| Money Markets | 1,225 |
| **Total upstream** | **303,092** |

This table is the upstream README count as of **2026-10-25**, not an installed or cross-source net-new LiOS count. Imported count must be observed from `npm run data:universe:verify`; union count is reported separately from `/api/finance/directory/status`.

## Feature integration (same PR)

- Importer: all seven categories by default; RFC-4180 CSV reader, strict symbol/name row validation; asset/venue/currency-specific dedup; per-file source checksums; full catalog SHA256; accepted/by-class/skipped/duplicate counts; atomic writes; locally retained previous catalog and `--rollback`.
- Existing master search: `loadFinanceDatabaseCatalog` preserves MIC, CUSIP, ISIN, FIGI, composite FIGI, share-class FIGI, currency, source, lifecycle status, provider-only provenance. Never invents an entity or trading venue.
- Existing Finance Directory/Autocomplete: `server/instrumentDirectory.ts` unifies source rows without double-reading downloaded CSVs. `routes.ts` exposes query, facet metadata, status and per-venue results; removed the old hardcoded mutual-fund rows. Historical rows require explicit opt-in.
- Existing Screener Panel: dynamic asset-class options and counts from real observed sources; visible installed reference count, historical toggle, source qualified React identity, identifiers in row tooltip.
- Route manifest: authenticated facets/status routes recorded; no added anonymous API endpoints.
- Data-root boundary: `src/data/` is ignored by public Git; runtime-owned catalogs are **not** inside electron-builder `extraResources`.

### Validation status and shipping constraints

- Source code and offline synthetic tests committed in **PR #217**.
- Full project `npm run test:offline` / `npm run check`: **NOT_RUN** in this GitHub connector session.
- Actual 303k import / SHA256 verification / UI package smoke: **NOT_RUN** (no full donor dataset or local test runner in this connector).
- V2 installed directory smoke and V3/V4 macOS/Windows package tests: **NOT_RUN**.
- Source CI: view current PR checks, do not claim green without result.
- General-user one-click initial install/update UI requires an app-owned user-consented downloader that does not depend on Git; the CLI is presently for owner provisioning and does **not** alone satisfy a consumer-packaged UX gate.
- User-local import makes no promise that every input has redistributable assets or working quote/statement services. A complete 300k **reference list** cannot be marketed as 300k **live market-data securities**.

## Additional donor options (do not substitute entity counts)

- SEC EDGAR (CIK/company filings) and NASDAQ Trader (listing tables) are **already integrated** into LiOS and should enrich identity and freshness rather than duplicate a second catalog service.
- OpenFIGI (FIGI mapping), GLEIF (LEI/legal entity data) and public exchange listings are *enrichment*, not independent proof of tradable security coverage; obey rate limits and rights.
- Do not silently import GPL/AGPL components, prohibitively licensed exchange data, or OpenBB reintroductions. No paid API, hosted search service, or central runtime is necessary for the donor CSV reference import.
