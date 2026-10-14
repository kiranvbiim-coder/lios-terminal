import sys
import argparse
import json
import pandas as pd
import yfinance as yf
from datetime import datetime

def download_historical_data(symbol, period="5y", interval="1d"):
    try:
        # yfinance adjustments (e.g., ^NSEI, standard stock symbols)
        # yfinance uses '.NS' for NSE stocks, e.g., RELIANCE.NS.
        ticker = yf.Ticker(symbol)
        
        # Download historical market data
        df = ticker.history(period=period, interval=interval)
        
        if df.empty:
            print(json.dumps({"error": f"No data found for symbol {symbol}"}))
            return
        
        bars = []
        for index, row in df.iterrows():
            # Some symbols (observed on HK-listed stocks in particular) have
            # rows with missing OHLC data (NaN) on irregular trading days.
            # Python's json.dumps() emits a literal `NaN` token for these,
            # which is not valid JSON per spec -- JavaScript's JSON.parse()
            # correctly rejects it, which silently broke every quote/history
            # fetch for the whole symbol (not just the one bad bar). Skip
            # rows with missing core fields instead of emitting invalid data.
            if row[["Open", "High", "Low", "Close"]].isna().any():
                continue

            # Date/Time formatting
            # index can be a Timestamp
            if hasattr(index, 'to_pydatetime'):
                dt = index.to_pydatetime()
            else:
                dt = index

            date_str = dt.strftime("%Y-%m-%d")

            # Formulate the bar structure matching the Express server schema:
            # { date: string, open: number, high: number, low: number, close: number, volume: number }
            bars.append({
                "date": date_str,
                "open": round(float(row["Open"]), 4),
                "high": round(float(row["High"]), 4),
                "low": round(float(row["Low"]), 4),
                "close": round(float(row["Close"]), 4),
                "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0
            })
            
        # Print valid JSON to stdout
        print(json.dumps(bars))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download Yahoo Finance historical data")
    parser.add_argument("--symbol", required=True, help="Stock ticker symbol")
    parser.add_argument("--range", default="5y", help="Range period (e.g., 1y, 5y, max)")
    parser.add_argument("--interval", default="1d", help="Interval (e.g., 1d, 1h, 15m)")
    
    args = parser.parse_args()
    
    # Map range terms (e.g., 5Y -> 5y)
    range_val = args.range.lower()
    interval_val = args.interval.lower()
    
    # yfinance valid periods: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
    valid_periods = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
    if range_val not in valid_periods:
        # Fallback to max for 25y or any other custom range
        range_val = "max"
    
    download_historical_data(args.symbol, period=range_val, interval=interval_val)
