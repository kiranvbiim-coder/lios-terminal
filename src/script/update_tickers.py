import urllib.request
import json
import csv
import sys
import os
import re

def main():
    print("Starting stock universe update script...")
    tickers_list = []
    
    # ─── Consolidated Indices, Commodities Futures, Forex & Cryptos ─────────
    custom_assets = [
        # Indices
        {"symbol": "^GSPC", "name": "S&P 500 Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "US"},
        {"symbol": "^DJI", "name": "Dow Jones Industrial Average", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "US"},
        {"symbol": "^IXIC", "name": "NASDAQ Composite Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "US"},
        {"symbol": "^RUT", "name": "Russell 2000 Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "US"},
        {"symbol": "^VIX", "name": "CBOE Volatility Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "US"},
        {"symbol": "^NSEI", "name": "Nifty 50 Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "IN"},
        {"symbol": "^BSESN", "name": "BSE Sensex Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "IN"},
        {"symbol": "^FTSE", "name": "FTSE 100 Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "UK"},
        {"symbol": "^N225", "name": "Nikkei 225 Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "JP"},
        {"symbol": "^HSI", "name": "Hang Seng Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "HK"},
        {"symbol": "^GDAXI", "name": "DAX Performance Index", "exchange": "INDEX", "sector": "Index", "assetClass": "index", "region": "DE"},
        
        # Commodities
        {"symbol": "GC=F", "name": "Gold Futures", "exchange": "COMMODITY", "sector": "Commodity", "assetClass": "commodity", "region": "GL"},
        {"symbol": "CL=F", "name": "Crude Oil WTI Futures", "exchange": "COMMODITY", "sector": "Commodity", "assetClass": "commodity", "region": "GL"},
        {"symbol": "BZ=F", "name": "Brent Crude Oil Futures", "exchange": "COMMODITY", "sector": "Commodity", "assetClass": "commodity", "region": "GL"},
        {"symbol": "NG=F", "name": "Natural Gas Futures", "exchange": "COMMODITY", "sector": "Commodity", "assetClass": "commodity", "region": "GL"},
        {"symbol": "SI=F", "name": "Silver Futures", "exchange": "COMMODITY", "sector": "Commodity", "assetClass": "commodity", "region": "GL"},
        {"symbol": "HG=F", "name": "Copper Futures", "exchange": "COMMODITY", "sector": "Commodity", "assetClass": "commodity", "region": "GL"},
        
        # Forex (FX)
        {"symbol": "EURUSD=X", "name": "EUR/USD Currency Cross", "exchange": "FOREX", "sector": "Forex", "assetClass": "forex", "region": "GL"},
        {"symbol": "USDJPY=X", "name": "USD/JPY Currency Cross", "exchange": "FOREX", "sector": "Forex", "assetClass": "forex", "region": "GL"},
        {"symbol": "GBPUSD=X", "name": "GBP/USD Currency Cross", "exchange": "FOREX", "sector": "Forex", "assetClass": "forex", "region": "GL"},
        {"symbol": "USDINR=X", "name": "USD/INR Currency Cross", "exchange": "FOREX", "sector": "Forex", "assetClass": "forex", "region": "GL"},
        {"symbol": "AUDUSD=X", "name": "AUD/USD Currency Cross", "exchange": "FOREX", "sector": "Forex", "assetClass": "forex", "region": "GL"},
        {"symbol": "USDCAD=X", "name": "USD/CAD Currency Cross", "exchange": "FOREX", "sector": "Forex", "assetClass": "forex", "region": "GL"},
        
        # Crypto
        {"symbol": "BTC-USD", "name": "Bitcoin USD", "exchange": "CRYPTO", "sector": "Crypto", "assetClass": "crypto", "region": "GL"},
        {"symbol": "ETH-USD", "name": "Ethereum USD", "exchange": "CRYPTO", "sector": "Crypto", "assetClass": "crypto", "region": "GL"},
        {"symbol": "SOL-USD", "name": "Solana USD", "exchange": "CRYPTO", "sector": "Crypto", "assetClass": "crypto", "region": "GL"}
    ]
    tickers_list.extend(custom_assets)

    # We will keep a set of all added symbols to prevent duplicates
    seen_symbols = {asset["symbol"] for asset in custom_assets}

    # 1. Fetch SEC US Tickers Directory
    print("Fetching US market directory from SEC...")
    try:
        req = urllib.request.Request(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "LimuriaTerminalApp kiran@example.com"}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            sec_data = json.loads(response.read().decode("utf-8"))
            
            for item in sec_data.values():
                symbol = item["ticker"].upper().replace("-", "")
                if symbol in seen_symbols:
                    continue
                seen_symbols.add(symbol)
                
                title = item["title"].title()
                exchange = "NASDAQ" if len(symbol) >= 4 else "NYSE"
                tickers_list.append({
                    "symbol": symbol,
                    "name": title,
                    "exchange": exchange,
                    "sector": "US Equity",
                    "assetClass": "equity",
                    "region": "US"
                })
        print(f"Loaded symbols from US exchanges (Total list: {len(tickers_list)}).")
    except Exception as e:
        print(f"Warning: Failed to fetch US tickers directory: {e}")

    # 2. Fetch NSE India Directory
    print("Fetching Indian market directory from NSE...")
    try:
        req = urllib.request.Request(
            "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            lines = [line.decode("utf-8") for line in response.readlines()]
            reader = csv.reader(lines)
            header = next(reader) # skip header
            
            nse_count = 0
            for row in reader:
                if len(row) >= 2:
                    symbol = f"{row[0].upper()}.NS"
                    if symbol in seen_symbols:
                        continue
                    seen_symbols.add(symbol)
                    
                    company_name = row[1].strip()
                    tickers_list.append({
                        "symbol": symbol,
                        "name": company_name,
                        "exchange": "NSE",
                        "sector": "Indian Equity",
                        "assetClass": "equity",
                        "region": "IN"
                    })
                    nse_count += 1
        print(f"Loaded {nse_count} symbols from National Stock Exchange (India).")
    except Exception as e:
        print(f"Warning: Failed to fetch NSE directory: {e}")

    # 3. Fetch Full BSE India Directory (Kite Instruments Master List)
    print("Fetching complete Indian market directory from BSE...")
    try:
        req = urllib.request.Request(
            "https://api.kite.trade/instruments",
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
        )
        with urllib.request.urlopen(req, timeout=25) as response:
            lines = [line.decode("utf-8") for line in response.readlines()]
            reader = csv.reader(lines)
            header = next(reader) # skip header
            
            bse_count = 0
            for row in reader:
                if len(row) >= 12:
                    scrip_code = row[1].strip()
                    company_name = row[3].strip()
                    instrument_type = row[9].strip()
                    exchange = row[11].strip()
                    
                    if exchange == "BSE" and instrument_type == "EQ" and scrip_code.isdigit():
                        symbol = f"{scrip_code}.BO"
                        if symbol in seen_symbols:
                            continue
                        seen_symbols.add(symbol)
                        
                        tickers_list.append({
                            "symbol": symbol,
                            "name": company_name,
                            "exchange": "BSE",
                            "sector": "Indian Equity",
                            "assetClass": "equity",
                            "region": "IN"
                        })
                        bse_count += 1
        print(f"Loaded {bse_count} symbols from Bombay Stock Exchange (India).")
    except Exception as e:
        print(f"Warning: Failed to fetch BSE directory: {e}")

    # 4. Fetch Global Stocks from core_listings.csv (TSE, HKEX, LSE, XETRA, TSX, ASX, SGX)
    print("Fetching global stocks from core_listings.csv...")
    try:
        req = urllib.request.Request(
            "https://raw.githubusercontent.com/adanos-software/free-ticker-database/main/data/core_listings.csv",
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
        )
        with urllib.request.urlopen(req, timeout=120) as response:
            lines = [line.decode("utf-8") for line in response.readlines()]
            reader = csv.reader(lines)
            header = next(reader) # skip header
            
            global_count = 0
            exchange_mappings = {
                "TSE": (".T", "Japanese Equity", "JP"),
                "HKEX": (".HK", "Hong Kong Equity", "HK"),
                "LSE": (".L", "UK Equity", "UK"),
                "XETRA": (".DE", "German Equity", "DE"),
                "TSX": (".TO", "Canadian Equity", "CA"),
                "ASX": (".AX", "Australian Equity", "AU"),
                "SGX": (".SI", "Singapore Equity", "SG"),
                "TWSE": (".TW", "Taiwanese Equity", "TW"),
                "TPEX": (".TWO", "Taiwanese Equity", "TW"),
                "KRX": (".KS", "South Korean Equity", "KR"),
                "KOSDAQ": (".KQ", "South Korean Equity", "KR"),
                "SSE": (".SS", "Chinese Equity", "CN"),
                "SZSE": (".SZ", "Chinese Equity", "CN"),
                "B3": (".SA", "Brazilian Equity", "BR"),
                "Bursa": (".KL", "Malaysian Equity", "MY")
            }
            
            for row in reader:
                if len(row) >= 10:
                    ticker_raw = row[1].strip()
                    exchange_tag = row[2].strip()
                    company_name = row[3].strip()
                    
                    if exchange_tag in exchange_mappings or exchange_tag == "Euronext":
                        suffix = ""
                        sector_name = "Equity"
                        region = "GL"
                        
                        if exchange_tag == "Euronext":
                            country_code = row[8].strip().upper()
                            if country_code == "FR":
                                suffix, sector_name, region = (".PA", "French Equity", "FR")
                            elif country_code == "NL":
                                suffix, sector_name, region = (".AS", "Dutch Equity", "NL")
                            elif country_code == "BE":
                                suffix, sector_name, region = (".BR", "Belgian Equity", "BE")
                            elif country_code == "PT":
                                suffix, sector_name, region = (".LS", "Portuguese Equity", "PT")
                            else:
                                suffix, sector_name, region = (".PA", "Euronext Equity", "FR")
                        else:
                            suffix, sector_name, region = exchange_mappings[exchange_tag]
                            
                        # Format Hong Kong scrips (e.g. 00001 -> 0001 to align with 4-digit Yahoo Finance)
                        if exchange_tag == "HKEX" and len(ticker_raw) == 5 and ticker_raw.startswith("0"):
                            ticker_raw = ticker_raw[1:]
                            
                        symbol = f"{ticker_raw}{suffix}"
                        if symbol in seen_symbols:
                            continue
                        seen_symbols.add(symbol)
                        
                        parsed_sector = row[5].strip() if len(row) > 5 and row[5].strip() else sector_name
                        sector_mappings = {
                            "Financials": "Financial Services",
                            "Information Technology": "Technology",
                            "Consumer Discretionary": "Consumer Cyclical",
                            "Consumer Staples": "Consumer Defensive",
                            "Materials": "Basic Materials"
                        }
                        if parsed_sector in sector_mappings:
                            parsed_sector = sector_mappings[parsed_sector]
                        
                        tickers_list.append({
                            "symbol": symbol,
                            "name": company_name,
                            "exchange": exchange_tag,
                            "sector": parsed_sector,
                            "assetClass": "equity",
                            "region": region
                        })
                        global_count += 1
        print(f"Loaded {global_count} global symbols from core_listings.csv.")
    except Exception as e:
        print(f"Warning: Failed to fetch global stocks from core_listings.csv: {e}")

    # 5. Fetch and Merge Hang Seng Index Constituents (HKEX Blue Chips)
    print("Fetching Hang Seng Index constituents for HKEX coverage...")
    try:
        req = urllib.request.Request(
            "https://yfiua.github.io/index-constituents/constituents-hsi.csv",
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            lines = [line.decode("utf-8") for line in response.readlines()]
            reader = csv.reader(lines)
            header = next(reader) # skip header
            
            hsi_count = 0
            for row in reader:
                if len(row) >= 2:
                    symbol = row[0].strip().upper()
                    company_name = row[1].strip()
                    
                    if symbol in seen_symbols:
                        continue
                    seen_symbols.add(symbol)
                    
                    tickers_list.append({
                        "symbol": symbol,
                        "name": company_name,
                        "exchange": "HKEX",
                        "sector": "Hong Kong Equity",
                        "assetClass": "equity",
                        "region": "HK"
                    })
                    hsi_count += 1
        print(f"Merged {hsi_count} Hang Seng Index components.")
    except Exception as e:
        print(f"Warning: Failed to fetch HSI constituents: {e}")

    # 6. Fetch and Merge Nikkei 225 Constituents (TSE Blue Chips)
    print("Fetching Nikkei 225 constituents from Wikipedia for TSE coverage...")
    try:
        req = urllib.request.Request(
            "https://en.wikipedia.org/wiki/Nikkei_225",
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode("utf-8")
        
        li_pattern = re.compile(r'<li[^>]*>(.*?)</li>', re.DOTALL)
        tyo_pattern = re.compile(r'TYO.*?(\d{4})', re.DOTALL)
        a_pattern = re.compile(r'<a[^>]*>(.*?)</a>', re.DOTALL)
        
        n225_count = 0
        for li in li_pattern.finditer(html):
            content = li.group(1)
            if "TYO" in content:
                tyo_match = tyo_pattern.search(content)
                a_match = a_pattern.search(content)
                if tyo_match and a_match:
                    code = tyo_match.group(1)
                    name = re.sub('<[^<]+?>', '', a_match.group(1)).strip()
                    # Skip common formatting noise
                    if name.lower() in ["[update]", "clarification needed"]:
                        continue
                        
                    symbol = f"{code}.T"
                    if symbol in seen_symbols:
                        continue
                    seen_symbols.add(symbol)
                    
                    tickers_list.append({
                        "symbol": symbol,
                        "name": name,
                        "exchange": "TSE",
                        "sector": "Japanese Equity",
                        "assetClass": "equity",
                        "region": "JP"
                    })
                    n225_count += 1
        print(f"Merged {n225_count} Nikkei 225 components.")
    except Exception as e:
        print(f"Warning: Failed to parse Nikkei 225 constituents: {e}")

    # Ensure directories exist
    target_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "server", "data")
    os.makedirs(target_dir, exist_ok=True)
    target_file = os.path.join(target_dir, "tickers.json")

    print(f"Saving compiled database with {len(tickers_list)} tickers to {target_file}...")
    with open(target_file, "w", encoding="utf-8") as f:
        json.dump(tickers_list, f, indent=2, ensure_ascii=False)
    print("Stock directory compilation completed successfully.")

if __name__ == "__main__":
    main()
