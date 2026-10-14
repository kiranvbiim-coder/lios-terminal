"""
Raw financial-statement puller for yfinanceFinancials.ts -- the broad
fallback provider in the financial-reports waterfall (see
financialDataProviders.ts), for symbols LSE/SEC EDGAR/Screener.in/BSE
India/XBRL Filings.org all have nothing for. Confirmed live before being
built: China A-shares (SSE/SZSE, e.g. 002206.SZ), the exact gap
financialDataProviders.ts's own top comment already named, have zero LSE
coverage but real, complete yfinance statement data (51 real line items
across 4 fiscal years for that exact symbol).

This script only extracts and prints yfinance's own named rows -- no field
renaming or derivation happens here, that's yfinanceFinancials.ts's job
(same separation as download_fundamentals.py/download_history.py already
use for the rest of this app's yfinance integration).

Usage: python3 script/fetch_yfinance_financials.py --symbol 002206.SZ --report-type income
report-type: income | balance | cashflow
"""
import argparse
import json
import yfinance as yf


def to_records(df):
    if df is None or df.empty:
        return {}
    out = {}
    for col in df.columns:
        period_end = col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col)
        period_data = {}
        for row_name in df.index:
            val = df.loc[row_name, col]
            try:
                if val is not None and str(val) != "nan":
                    period_data[row_name] = float(val)
            except (TypeError, ValueError):
                pass
        if period_data:
            out[period_end] = period_data
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--report-type", required=True, choices=["income", "balance", "cashflow"])
    args = parser.parse_args()

    try:
        ticker = yf.Ticker(args.symbol)
        if args.report_type == "income":
            annual = to_records(ticker.financials)
        elif args.report_type == "balance":
            annual = to_records(ticker.balance_sheet)
        else:
            annual = to_records(ticker.cashflow)

        if not annual:
            print(json.dumps({"error": f"No {args.report_type} statement data found for {args.symbol}"}))
            return

        print(json.dumps({"symbol": args.symbol, "reportType": args.report_type, "periods": annual}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
