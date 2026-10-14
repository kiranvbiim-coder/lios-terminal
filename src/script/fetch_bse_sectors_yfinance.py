"""
Real fix for BSE, not a "data source doesn't have it" writeoff: yfinance's
sector/industry metadata endpoint returns nothing for BSE's numeric scrip
codes (e.g. "500325.BO") -- confirmed empirically, 0/15 major large-caps
(RELIANCE, TCS, HDFCBANK, INFY, ...) resolved. But the SAME companies
resolve perfectly (15/15) once queried by their real alphabetic ticker
instead (e.g. "RELIANCE.BO" or "RELIANCE.NS") -- the numeric code itself is
the problem, not a genuine absence of BSE data in yfinance.

BSE's own official BhavCopy CSV (the same live, verified endpoint already
used by server/bseBhavcopy.ts for price history) carries a real
TckrSymb column mapping every numeric FinInstrmId to its real alphabetic
ticker -- so this script builds that crosswalk directly from BSE's own
published data (no invented mapping, no guessing), then re-queries
yfinance using each resolved alphabetic ticker (suffixed .BO to stay
consistent with tickers.json's existing BSE symbol convention), while
still keying every output row by the ORIGINAL numeric symbol so it matches
how the rest of the app already addresses BSE names.

Coverage check before running the real job: of the 5,532 BSE numeric codes
in tickers.json, 4,450 (80.4%) matched a live ticker in a same-day bhavcopy
snapshot; the remaining ~1,082 are presumably delisted/renamed since
tickers.json was built and are skipped rather than guessed at.

Usage: python3 script/fetch_bse_sectors_yfinance.py
Resumable: skips symbols already present in the output file.
"""
import csv
import io
import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import yfinance as yf

TICKERS_PATH = os.path.join(os.path.dirname(__file__), "..", "server", "data", "tickers.json")
OUTPUT_PATH = "/private/tmp/claude-501/-Users-kiran-Desktop/49439f4a-4075-4716-bef1-c158048df700/scratchpad/yf_bse_sectors_results.jsonl"
MAX_WORKERS = 12
BSE_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}


def fetch_bhavcopy_crosswalk():
    """Walk back from today until a real trading-day bhavcopy is found
    (weekends/holidays return an HTML error page, not real CSV data)."""
    for days_back in range(10):
        d = datetime.now() - timedelta(days=days_back)
        ymd = d.strftime("%Y%m%d")
        url = f"https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{ymd}_F_0000.CSV"
        try:
            req = urllib.request.Request(url, headers=BSE_HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            if "TckrSymb" not in text:
                continue
            reader = csv.DictReader(io.StringIO(text))
            crosswalk = {}
            for row in reader:
                code = row.get("FinInstrmId", "").strip()
                ticker = row.get("TckrSymb", "").strip()
                if code and ticker:
                    crosswalk[code] = ticker
            if crosswalk:
                print(f"Bhavcopy crosswalk built from {ymd}: {len(crosswalk)} real symbol mappings.")
                return crosswalk
        except Exception as e:
            print(f"  bhavcopy fetch failed for {ymd}: {e}")
    raise RuntimeError("Could not fetch a real BSE bhavcopy in the last 10 days.")


ERROR_RATE_THRESHOLD = 0.25
COOLDOWN_SECONDS = 90
BATCH_SIZE = 50
REQUEST_SPACING_SECONDS = 0.15


def load_done(path):
    done = set()
    if os.path.exists(path):
        with open(path, "r") as f:
            for line in f:
                try:
                    row = json.loads(line)
                    if "error" not in row:  # only a genuine result counts as done -- see fetch_sectors_yfinance.py
                        done.add(row["symbol"])
                except Exception:
                    pass
    return done


def is_transient_error(row) -> bool:
    err = row.get("error") or ""
    return any(s in err for s in ("Too Many Requests", "Rate limited", "Unauthorized", "Invalid Crumb"))


def fetch(numeric_symbol, alpha_ticker):
    try:
        info = yf.Ticker(f"{alpha_ticker}.BO").info or {}
        sector = info.get("sector")
        industry = info.get("industry")
        name = info.get("longName") or info.get("shortName")
        time.sleep(REQUEST_SPACING_SECONDS)
        return {"symbol": numeric_symbol, "resolvedTicker": alpha_ticker, "sector": sector,
                "industry": industry, "name": name, "country": "IN"}
    except Exception as e:
        return {"symbol": numeric_symbol, "resolvedTicker": alpha_ticker, "sector": None, "error": str(e)}


def main():
    with open(TICKERS_PATH, "r") as f:
        tickers = json.load(f)
    bse_codes = [t["symbol"].upper().replace(".BO", "") for t in tickers if t["symbol"].upper().endswith(".BO")]
    print(f"BSE numeric codes in tickers.json: {len(bse_codes)}.")

    crosswalk = fetch_bhavcopy_crosswalk()
    resolvable = [(code, crosswalk[code]) for code in bse_codes if code in crosswalk]
    print(f"Resolvable to a real alphabetic ticker: {len(resolvable)} ({len(resolvable) / len(bse_codes) * 100:.1f}%).")

    done = load_done(OUTPUT_PATH)
    print(f"Already genuinely done from a previous run: {len(done)}.")
    remaining = [(code, alpha) for code, alpha in resolvable if f"{code}.BO" not in done]
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
            futures = {ex.submit(fetch, f"{code}.BO", alpha): code for code, alpha in batch}
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
