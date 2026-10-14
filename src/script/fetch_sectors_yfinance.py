"""
Phase A of the real peer-universe backfill: fetches real sector/industry for
every real equity ticker in tickers.json via yfinance, concurrently, and
streams results to a JSON-lines file. Does NOT touch the app database --
see backfill_sectors_to_db.ts for the DB-write phase, kept
deliberately separate so this network-bound phase can run freely without
any PGlite concurrency concern (the app's local Postgres must never be
opened by two processes at once; this script never opens it at all).

Superseded the original LSE-based backfill (script/backfill_company_profiles.ts,
scoped to NASDAQ/NYSE only): a live side-by-side test showed yfinance has
real coverage far beyond LSE's US-centric company-profile endpoint --
87.5% hit rate on a mixed US/international sample (vs. LSE's ~3% on a
matched international sample) at ~513 symbols/min with 12 concurrent
workers (vs. LSE's ~45/min, rate-capped by its free-tier 100 calls/min
account-wide limit). BSE (.BO suffix) tickers are excluded here --
confirmed via this same test (three real BSE numeric codes all returned
sector=None) that this matches the prior ticker-audit finding that Yahoo's
data for BSE numeric-coded scrips is broken at the source, not a
config/mapping issue worth spending API budget probing further.

Usage: python3 script/fetch_sectors_yfinance.py
Resumable: skips symbols with a genuine result (real sector, or a clean
"no sector" resolution) from a previous run. A row that failed with an
exception (rate-limit, crumb/session error, network blip) is NOT counted
as done -- it's retried on the next run, since treating a transient error
as a permanent miss is exactly what silently threw away ~27,000 real
attempts the first time this ran (12 concurrent workers with no backoff
detection hammered straight through a Yahoo rate-limit block instead of
noticing and pausing).

Backoff: processed in small batches (BATCH_SIZE), lower concurrency than
the original 12-worker version, and after each batch, if more than
ERROR_RATE_THRESHOLD of it failed, sleeps COOLDOWN_SECONDS before
continuing rather than plowing through the rest of the list while blocked.
"""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import yfinance as yf

TICKERS_PATH = os.path.join(os.path.dirname(__file__), "..", "server", "data", "tickers.json")
OUTPUT_PATH = "/private/tmp/claude-501/-Users-kiran-Desktop/49439f4a-4075-4716-bef1-c158048df700/scratchpad/yf_sectors_results.jsonl"
MAX_WORKERS = 5
BATCH_SIZE = 50
ERROR_RATE_THRESHOLD = 0.25
COOLDOWN_SECONDS = 90
REQUEST_SPACING_SECONDS = 0.15  # small per-call delay inside each worker, on top of concurrency limit


def load_done(path):
    done = set()
    if os.path.exists(path):
        with open(path, "r") as f:
            for line in f:
                try:
                    row = json.loads(line)
                    # Only a genuine result (real sector, or a clean
                    # exception-free "no sector") counts as done. Anything
                    # that raised (rate limit, crumb failure, network
                    # error) must be retried, not treated as resolved.
                    if "error" not in row:
                        done.add(row["symbol"])
                except Exception:
                    pass
    return done


def fetch(symbol):
    try:
        info = yf.Ticker(symbol).info or {}
        sector = info.get("sector")
        industry = info.get("industry")
        name = info.get("longName") or info.get("shortName")
        currency = info.get("currency")
        country = info.get("country")
        time.sleep(REQUEST_SPACING_SECONDS)
        return {"symbol": symbol, "sector": sector, "industry": industry, "name": name,
                "currency": currency, "country": country}
    except Exception as e:
        return {"symbol": symbol, "sector": None, "error": str(e)}


def is_transient_error(row) -> bool:
    err = row.get("error") or ""
    return any(s in err for s in ("Too Many Requests", "Rate limited", "Unauthorized", "Invalid Crumb"))


def main():
    with open(TICKERS_PATH, "r") as f:
        tickers = json.load(f)

    targets = [t for t in tickers if t.get("assetClass") == "equity" and not t["symbol"].upper().endswith(".BO")]
    print(f"Target universe: {len(targets)} equity symbols (excludes BSE .BO -- handled by the separate BSE alphabetic-ticker script).")

    done = load_done(OUTPUT_PATH)
    print(f"Already genuinely done from a previous run: {len(done)}.")
    remaining = [t for t in targets if t["symbol"] not in done]
    print(f"Remaining to fetch: {len(remaining)}.")

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    out = open(OUTPUT_PATH, "a")

    hit = 0
    miss = 0
    transient = 0
    start = time.time()
    completed = 0

    for batch_start in range(0, len(remaining), BATCH_SIZE):
        batch = remaining[batch_start:batch_start + BATCH_SIZE]
        batch_transient = 0

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            futures = {ex.submit(fetch, t["symbol"]): t["symbol"] for t in batch}
            for fut in as_completed(futures):
                result = fut.result()
                out.write(json.dumps(result) + "\n")
                completed += 1
                if result.get("sector"):
                    hit += 1
                elif is_transient_error(result):
                    miss += 1
                    transient += 1
                    batch_transient += 1
                else:
                    miss += 1

        out.flush()
        elapsed_min = (time.time() - start) / 60
        rate = completed / elapsed_min if elapsed_min > 0 else 0
        eta_min = (len(remaining) - completed) / rate if rate > 0 else 0
        print(f"  {completed}/{len(remaining)} -- hit={hit} miss={miss} (transient={transient}) -- {rate:.0f}/min -- ETA {eta_min:.0f}min")

        if len(batch) > 0 and (batch_transient / len(batch)) > ERROR_RATE_THRESHOLD:
            print(f"  batch error rate {batch_transient}/{len(batch)} exceeds threshold -- cooling down {COOLDOWN_SECONDS}s")
            time.sleep(COOLDOWN_SECONDS)

    out.close()
    print("")
    print(f"Done. hit={hit} miss={miss} (transient, will retry next run={transient}) out of {len(remaining)} fetched this run.")
    print(f"Results file: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
