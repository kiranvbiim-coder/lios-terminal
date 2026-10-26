# LiOS instrument catalog recovery — private-to-public migration

**Purpose:** Recover LiOS's original instrument universe into a local build directory without exposing non-reviewed provider data in the public source repository.

## What happened

The private repository retained the datasets under src/server/data. The public repository deliberately ignores src/server/data/ to avoid accidental publication of proprietary/provider/academic datasets. The loaders and Electron extraResources configuration still expect these local files. Ignored files do not transfer when creating a public repository.

## Original snapshots verified in private repository

| Output filename | Exact original Git blob SHA-1 | Record count |
|---|---|---:|
| tickers.json | f9edacb9d8dc04485b868ab9ee44638fbbcf416d | 67,217 |
| crypto_coingecko_ids.json | ca29d5000a89a7382309d667800e495010662662 | 10,923 |
| provider_ingested_universe.json | 8b9e82b4143d453a0d0c8e7804820cf7a778cd43 | 15,592 |

The recovery tool verifies these exact Git blob hashes before accepting privately fetched bytes; it also validates each dataset's schema and counts.

## Restore original data on developer machine (no paid services)

Install and authenticate the free GitHub CLI (gh) with read access to the original private repo. From the src project directory, run:

    export LIOS_CATALOG_SOURCE_REPO='OWNER/ORIGINAL-PRIVATE-REPO'
    gh auth status
    npm run catalog:restore -- --from-private
    npm run catalog:check
    npm run test:catalog

Replace OWNER/ORIGINAL-PRIVATE-REPO with the private source repository. The CLI downloads exact pinned blobs via your own authenticated GitHub account and writes only to the local, ignored src/server/data/ directory. It never prints access tokens or publishes data.

For data already recovered into another local checkout:

    npm run catalog:restore -- --source-dir=/absolute/path/to/old-repo/src/server/data
    npm run catalog:check

Existing conflicting files are not silently overwritten. Use --force only after reviewing source and destination differences.

## Packaging guard and tests

All desktop packaging commands (app:pack, app:dist:*, app:beta:*) now check that the three catalogs exist, contain realistic records, and match any local SHA-256 recovery manifest. They fail with explicit restoration instructions rather than shipping an installer with empty searches.

The existing Electron extraResources entry server/data/**/* bundles recovered local data into the installer. **This packaging inclusion is permitted only after reviewing each original source's redistribution rights.** Original sources include third-party directory/provider data; being available inside the owner's private GitHub repo does not prove that public redistribution is permitted.

The synthetic offline tests require no private-repo access or paid CI and do not carry copied dataset bytes.

## Existing architecture must be preserved

Use legacyTickerCatalog.ts, providerIngestedCatalog.ts, instrumentSearchIndexStore.ts and Global Instrument Master. Do not introduce a second identity master or automatically canonize ambiguous symbols. Keep exchange, provider metadata and tenant/entitlement boundaries.

Separate follow-up: remove remaining AAPL placeholder defaults, repair missing quote handling, improve peer discovery and add end-to-end source-backed market tests. This specific PR fixes availability and package validation of the original catalogs; it does not claim those financial-runtime bugs are fixed.

## Repository safeguards

Keep public .gitignore and PUBLIC_REPOSITORY_SAFEGUARDS.md unchanged. Do not force-add provider data to the public Git history. The release remains within the owner's zero-cost constraint; no commercial data API, paid signing or paid infrastructure is required.
