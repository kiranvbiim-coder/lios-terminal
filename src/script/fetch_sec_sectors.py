"""
A different, fully independent real data source for the same peer-universe
backfill: SEC EDGAR's own official SIC (Standard Industrial Classification)
per filer, via the same public, sanctioned, already-integrated endpoints
server/secEdgarData.ts already uses (company_tickers.json for the ticker->
CIK map, data.sec.gov/submissions/CIK{cik}.json for the filer's own record,
which includes a real `sic`/`sicDescription`).

Why this, in addition to the yfinance backfill rather than instead of it:
this is a genuinely separate provider/domain from Yahoo, so it runs at its
own real (and far more generous) rate limit -- SEC's own fair-access
guidance is ~10 requests/second, no account, no key -- without touching or
competing for Yahoo's IP-based throttle at all. It only covers SEC-
registered US filers (~10,387 tickers, verified via a live company_tickers.
json pull), a real subset of the full target universe, not a replacement
for the international coverage yfinance provides -- both are run, neither
supersedes the other, and companyStore.upsertCompany's coalesce-on-conflict
means whichever backfill reaches a symbol first doesn't get overwritten by
a later, different-but-still-real value from the other.

SIC codes are one classification level (e.g. 3571 "Electronic Computers"),
not GICS's two-level sector+industry -- `industry` below is the real
sicDescription; `sector` is the standard SIC "division" the code falls
into (Agriculture, Mining, Construction, Manufacturing, Transportation &
Utilities, Wholesale Trade, Retail Trade, Finance/Insurance/Real Estate,
Services, Public Administration -- the well-established, decades-old
grouping the US government itself uses for SIC ranges), not an invented
bucketing.

Usage: python3 script/fetch_sec_sectors.py
Resumable: skips symbols with a genuine result from a previous run.
"""
import json
import os
import time
import urllib.request

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
OUTPUT_PATH = "/private/tmp/claude-501/-Users-kiran-Desktop/49439f4a-4075-4716-bef1-c158048df700/scratchpad/sec_sectors_results.jsonl"
USER_AGENT = "Limuria Terminal research@example.com"  # SEC requires a real, descriptive User-Agent identifying the requester
REQUEST_SPACING_SECONDS = 0.15  # ~6.5 req/sec, safely under SEC's ~10 req/sec fair-access guidance


def sic_division(sic: str) -> str:
    try:
        code = int(sic)
    except (TypeError, ValueError):
        return "Other"
    if 100 <= code <= 999: return "Agriculture, Forestry & Fishing"
    if 1000 <= code <= 1499: return "Mining"
    if 1500 <= code <= 1799: return "Construction"
    if 2000 <= code <= 3999: return "Manufacturing"
    if 4000 <= code <= 4999: return "Transportation & Utilities"
    if 5000 <= code <= 5199: return "Wholesale Trade"
    if 5200 <= code <= 5999: return "Retail Trade"
    if 6000 <= code <= 6799: return "Finance, Insurance & Real Estate"
    if 7000 <= code <= 8999: return "Services"
    if 9100 <= code <= 9999: return "Public Administration"
    return "Other"


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_done(path):
    done = set()
    if os.path.exists(path):
        with open(path, "r") as f:
            for line in f:
                try:
                    row = json.loads(line)
                    if "error" not in row:
                        done.add(row["symbol"])
                except Exception:
                    pass
    return done


def main():
    print("Fetching SEC's official ticker -> CIK map...")
    ticker_map_raw = fetch_json(TICKER_MAP_URL)
    tickers = [(row["ticker"].upper(), str(row["cik_str"]).zfill(10), row["title"]) for row in ticker_map_raw.values()]
    print(f"SEC-registered tickers: {len(tickers)}.")

    done = load_done(OUTPUT_PATH)
    print(f"Already genuinely done from a previous run: {len(done)}.")
    remaining = [(sym, cik, name) for sym, cik, name in tickers if sym not in done]
    print(f"Remaining to fetch: {len(remaining)}.")

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    out = open(OUTPUT_PATH, "a")

    hit = 0
    miss = 0
    start = time.time()

    for i, (sym, cik, name) in enumerate(remaining):
        try:
            data = fetch_json(SUBMISSIONS_URL.format(cik=cik))
            sic = data.get("sic")
            sic_desc = data.get("sicDescription")
            real_name = data.get("name") or name
            if sic_desc:
                out.write(json.dumps({"symbol": sym, "sector": sic_division(sic), "industry": sic_desc, "name": real_name}) + "\n")
                hit += 1
            else:
                out.write(json.dumps({"symbol": sym, "sector": None}) + "\n")
                miss += 1
        except Exception as e:
            out.write(json.dumps({"symbol": sym, "sector": None, "error": str(e)}) + "\n")
            miss += 1

        if (i + 1) % 200 == 0:
            out.flush()
            elapsed_min = (time.time() - start) / 60
            rate = (i + 1) / elapsed_min if elapsed_min > 0 else 0
            eta_min = (len(remaining) - (i + 1)) / rate if rate > 0 else 0
            print(f"  {i+1}/{len(remaining)} -- hit={hit} miss={miss} -- {rate:.0f}/min -- ETA {eta_min:.0f}min")

        time.sleep(REQUEST_SPACING_SECONDS)

    out.close()
    print("")
    print(f"Done. hit={hit} miss={miss} out of {len(remaining)} fetched this run.")
    print(f"Results file: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
