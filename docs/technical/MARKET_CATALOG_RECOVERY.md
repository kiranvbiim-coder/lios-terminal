# LiOS market catalog recovery (public-source/private-data boundary)

**Canonical public application:** `kiranvbiim-coder/lios-terminal`. **Original private development repository:** `kiranvbiim-coder/lios-v1.0.0`.

## Root cause

The original 2026-10-14 public-repository import intentionally omitted private history and provider/academic datasets. The public `.gitignore` excludes `src/server/data/`, but existing loaders, Global Instrument Master search adapters, and the Electron `extraResources` declaration still expect market catalogs to exist at package-build time. The **source data were not lost**: the original private repository retains the audited files.

| Asset | Audited original row/key count | Original Git blob SHA | Consumer |
| --- | ---: | --- | --- |
| `tickers.json` | 67,217 | `f9edacb9d8dc04485b868ab9ee44638fbbcf416d` | legacyTickerCatalog; finance directory; symbol names |
| `provider_ingested_universe.json` | 15,592 | `8b9e82b4143d453a0d0c8e7804820cf7a778cd43` | providerIngestedCatalog; instrument search |
| `crypto_coingecko_ids.json` | 10,923 | `ca29d5000a89a7382309d667800e495010662662` | marketData CoinGecko identifier mapping |

The pinned ticker file contains exactly one non-instrument exchange footer (`FILE CREATION TIME: ...`). The original bytes remain unchanged for custody; `legacyTickerCatalog.ts` filters this record before instrument search. The expected usable ticker-row count is 67,216.

Do not interpret total catalog rows as unique tradable listings or verified live quote coverage. The catalog includes provisional, historical, exchange-specific and possibly overlapping identifiers.

## Restore and verify locally

Run from **`src/`**, on a machine with an authenticated `gh` CLI account that has read access to the old private repository:

```sh
gh auth status
npm run data:catalogs:restore
npm run data:catalogs:check
npm run test:data:catalogs
```

Alternatively, restore from an existing **private local checkout**, without network access:

```sh
node script/restore_market_catalogs.cjs --restore --from-dir /path/to/private/lios-v1.0.0
npm run data:catalogs:check
```

The recovery script verifies the **raw Git blob SHA**, structure and minimum dataset size before writing any original source. Existing structurally valid local catalogs are preserved by default, so a deliberate newer refresh is not erased. `--force` explicitly replaces them with the pinned originals (back up local generated changes first).

The restored assets live in `src/server/data/` on the build machine and remain ignored by Git. The desktop packaging script now invokes the local `--check` preflight: no silent installer missing all three catalogs.

## Data rights and release custody

Recovery **is not a redistribution license**. Before putting these datasets into any public installer or publishing packaged assets, audit each upstream source and its use/republication terms and confirm which files may be distributed. Especially review catalog rows assembled from third-party directories or screen-scraped sources. If redistribution cannot be established, use a user-operated post-install import/fetch workflow for that dataset instead of embedding it into a public download.

Never commit these three restored datasets to the public repository; never expose a GitHub personal access token in git, command output, CI logs or application resources. Do not change `.gitignore` to make the source assets public.

## Related fixes, distinct from recovery

- Eliminate hardcoded `AAPL` fallback in UI and peer-comparison paths, and preserve a typed missing-instrument/missing-quote state.
- Consolidate Global Instrument Master and legacy resolver entry points to prevent one catalog returning different identities from another.
- Verify actual consumer paths for packaged `server/data` resources under Electron.
- Establish coverage and freshness tests on real instrument identity records; separately test live provider quote capability and data entitlements.
- Keep reference files out of Git and preserve the owner's strict zero-cost release and local-first constraints.

**Scope of this change:** recovery tooling, testable asset checks, desktop packaging preflight, and agent guidance. It does **not** claim production packaging was exercised on macOS or Windows or that redistribution rights have been cleared.
