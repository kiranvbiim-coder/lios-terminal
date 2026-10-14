import argparse
import json
import yfinance as yf

# Fields pulled from yfinance's .info dict, renamed to match this app's
# camelCase convention. yfinance's own key names have shifted across versions
# (e.g. trailingPE has at times been under different keys), so each field
# tries a couple of known aliases and falls back to None rather than raising.
FIELD_ALIASES = {
    "marketCap": ["marketCap"],
    "trailingPE": ["trailingPE"],
    "forwardPE": ["forwardPE"],
    "trailingEps": ["trailingEps", "epsTrailingTwelveMonths"],
    "forwardEps": ["forwardEps"],
    "priceToBook": ["priceToBook"],
    "dividendYield": ["dividendYield"],
    "beta": ["beta"],
    "totalRevenue": ["totalRevenue"],
    "profitMargins": ["profitMargins"],
    "revenueGrowth": ["revenueGrowth"],
    "fiftyTwoWeekHigh": ["fiftyTwoWeekHigh"],
    "fiftyTwoWeekLow": ["fiftyTwoWeekLow"],
    "sharesOutstanding": ["sharesOutstanding"],
    "bookValue": ["bookValue"],
    "returnOnEquity": ["returnOnEquity"],
    "debtToEquity": ["debtToEquity"],
    "sector": ["sector"],
    "industry": ["industry"],
    "longName": ["longName", "shortName"],
    "currency": ["currency"],
}


def fetch_fundamentals(symbol: str) -> None:
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}

        # yfinance returns a near-empty dict (just a "symbol"/"trailingPegRatio"
        # scaffold) for symbols it can't actually resolve, rather than raising --
        # that's indistinguishable from "real ticker, no data yet" unless we
        # check for the presence of any actual data field.
        has_data = any(info.get(alias) is not None for aliases in FIELD_ALIASES.values() for alias in aliases)
        if not has_data:
            print(json.dumps({"error": f"No fundamentals data found for symbol {symbol}"}))
            return

        result = {"symbol": symbol}
        for field, aliases in FIELD_ALIASES.items():
            value = None
            for alias in aliases:
                if info.get(alias) is not None:
                    value = info.get(alias)
                    break
            result[field] = value

        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download Yahoo Finance fundamentals (market cap, P/E, EPS, etc.)")
    parser.add_argument("--symbol", required=True, help="Stock ticker symbol")
    args = parser.parse_args()
    fetch_fundamentals(args.symbol)
