# Recovering LiOS private instrument catalogs (2026-10-26)

**Source:** private `kiranvbiim-coder/lios-v1.0.0` (`main`). **Target:** public-source `kiranvbiim-coder/lios-terminal`, with *local-only ignored files* inside `src/server/data/`. The public repository's first commit intentionally omitted proprietary/private-data material; that omission is **not** data loss. No private history is copied to the public repository.

## Verified source inventory

| Data file | Git blob SHA-1 | Byte length | Runtime purpose |
| --- | --- | ---: | --- |
| `tickers.json` | `f9edacb9d8dc04485b868ab9ee44638fbbcf416d` | 11,882,813 | Broad stock/ETF/index/FX/commodity/crypto legacy directory and instrument fallback |
| `provider_ingested_universe.json` | `8b9e82b4143d453a0d0c8e7804820cf7a778cd43` | 2,745,198 | Provider-tagged SEC/Nasdaq Trader/CoinGecko instrument candidates |
| `crypto_coingecko_ids.json` | `ca29d5000a89a7382309d667800e495010662662` | 828,135 | Crypto ticker → CoinGecko ID mapping for live quote lookup |

The original ticker catalog contains 67,217 rows including one `FILE CREATION TIME:` vendor metadata record; the legacy loader now excludes that record from instrument search. The provider catalog contains 15,592 rows; the crypto map contains 10,923 IDs.

An additional `shillerCape.json` academic dataset remains private, but **it is not included in this recovery** because its licensing/provenance require a separate review. This patch restores only the three instrument foundation assets listed above. SHA-1 is used to compare Git's content-addressed blob identity to the original source; the asset contents never appear in public commits. The script also checks exact byte lengths, JSON structure and minimum record counts. This is a snapshot integrity check, **not** a redistribution-rights approval.

## Local recovery commands

From the **public repo's `src/` directory**, with installed `git` and authenticated `gh` CLI that can read the existing private repo:

```bash
# Authenticated PRIVATE clone, with sparse checkout, to a temporary directory;
# only validated files are copied into this local checkout.
npm run data:recover
npm run data:verify
npm run test:catalog-recovery
```

If a legitimate, up-to-date checkout of the private repo is already present:

```bash
node script/recover_instrument_catalogs.cjs --restore --from-dir /absolute/path/to/lios-v1.0.0
node script/recover_instrument_catalogs.cjs --verify
```

The recovery command never writes auth tokens or private history into public source; it uses the operator's existing GitHub CLI credentials, and it deletes its temporary sparse checkout. Existing local files that do not match the pinned snapshot are **never overwritten**. Ask the owner to preserve independent data modifications and review provenance before updating the pins. `src/server/data/` remains ignored in the public repository and will not be committed by standard `git add`.

## Packaging and completeness gate

Public packaging does not require access to the private source repository. The consolidated FinanceDatabase importer provides a separate opt-in, user-local reference catalog; recovered historical snapshots remain optional local inputs. `npm run data:verify` verifies those private inputs explicitly, not as an unconditional desktop-build prerequisite.

The consolidated package excludes `server/data/**/*`. Never add recovered datasets to the public repository, GitHub Actions artifacts or Releases without independently recorded redistribution rights. Private access and snapshot verification do not grant those rights. Public CI uses synthetic recovery fixtures and no private-repository credentials. Recovery publishes owner-only files using atomic no-replace links, including when another local writer creates the destination concurrently.

## Follow-up engineering checks after recovery

1. Verify restored row counts, exchange identities and crypto provider IDs on a local checkout; compare search-index coverage to the underlying snapshot.
2. Verify `/api/finance/directory`, canonical Global Instrument Master resolution, semantic company lookup and chat symbol selection share the same underlying entity authority.
3. Remove automatic `AAPL` fallbacks for unknown queries and remove arbitrary peers from comparisons. Missing values must never masquerade as zero-valued live prices.
4. Test packaged cold-start on macOS and Windows with explicit offline/data-disabled states. Record the exact private asset blob hashes and package inventory in privately held release evidence; do not treat the source gate as native acceptance.
5. Handle licensing and regeneration separately: existing `update_tickers.py` and `ingest_instrument_universe.ts` can produce later catalogs, but each updated snapshot requires provenance review and revised pins before a distributable build.

**Strict $0 release contract still applies.** This is a foundation-data recovery step, not a production-signing, paid CI or public release authorization.
