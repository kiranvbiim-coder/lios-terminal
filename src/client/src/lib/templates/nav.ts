/**
 * Net Asset Value (NAV) -- values a company (typically a holding company,
 * REIT, or investment fund) as the fair value of what it owns minus what it
 * owes, rather than as a multiple of earnings -- appropriate whenever the
 * balance sheet, not the income statement, is the real store of value (a
 * portfolio of real estate or securities can be worth far more or less than
 * book value, and its earnings run may not reflect that at all). The
 * premium/discount-to-NAV line at the bottom is the number that actually
 * matters in practice: a persistent discount is the standard signal used to
 * screen for holding-company and closed-end-fund value opportunities.
 */

export interface NavAsset {
  name: string;
  bookValue: number;
  fairValueAdjPct: number; // % adjustment applied to book value to reach fair value (negative for impaired/overstated assets)
}

export interface NavInputs {
  assets: NavAsset[];
  totalLiabilities: number;
  sharesOutstanding: number;
  marketPricePerShare: number;
}

export const DEFAULT_NAV_INPUTS: NavInputs = {
  assets: [
    { name: "Investment Portfolio", bookValue: 500, fairValueAdjPct: 20 },
    { name: "Real Estate Holdings", bookValue: 300, fairValueAdjPct: 40 },
    { name: "Cash & Equivalents", bookValue: 100, fairValueAdjPct: 0 },
    { name: "Other Operating Assets", bookValue: 150, fairValueAdjPct: -10 },
  ],
  totalLiabilities: 250,
  sharesOutstanding: 100,
  marketPricePerShare: 8,
};

export function buildNavModel(inputs: NavInputs = DEFAULT_NAV_INPUTS): Record<string, string> {
  const { assets, totalLiabilities, sharesOutstanding, marketPricePerShare } = inputs;
  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  set("A1", "NET ASSET VALUE (NAV)");

  let row = 3;
  set(`A${row}`, "ASSET"); set(`C${row}`, "BOOK VALUE ($M)"); set(`D${row}`, "FAIR VALUE ADJ %"); set(`E${row}`, "FAIR VALUE ($M)");
  const assetRows: number[] = [];
  for (const a of assets) {
    row++;
    assetRows.push(row);
    set(`A${row}`, a.name);
    set(`C${row}`, String(a.bookValue));
    set(`D${row}`, String(a.fairValueAdjPct));
    set(`E${row}`, `=C${row}*(1+D${row}/100)`);
  }
  const firstAssetRow = assetRows[0];
  const lastAssetRow = assetRows[assetRows.length - 1];

  const rTotalAssets = row + 2; set(`A${rTotalAssets}`, "TOTAL FAIR VALUE OF ASSETS"); set(`E${rTotalAssets}`, `=SUM(E${firstAssetRow}:E${lastAssetRow})`);

  const rLiabilities = rTotalAssets + 2; set(`A${rLiabilities}`, "Less: Total Liabilities (at fair value)"); set(`E${rLiabilities}`, String(-Math.abs(totalLiabilities)));

  const rNav = rLiabilities + 2; set(`A${rNav}`, "NET ASSET VALUE (NAV)"); set(`E${rNav}`, `=E${rTotalAssets}+E${rLiabilities}`);

  const rShares = rNav + 1; set(`A${rShares}`, "Shares Outstanding (M)"); set(`E${rShares}`, String(sharesOutstanding));
  const rNavPerShare = rShares + 1; set(`A${rNavPerShare}`, "NAV PER SHARE ($)"); set(`E${rNavPerShare}`, `=E${rNav}/E${rShares}`);

  const rMarketPrice = rNavPerShare + 2; set(`A${rMarketPrice}`, "Current Market Price per Share ($)"); set(`E${rMarketPrice}`, String(marketPricePerShare));
  const rPremDisc = rMarketPrice + 1; set(`A${rPremDisc}`, "Premium / (Discount) to NAV %"); set(`E${rPremDisc}`, `=(E${rMarketPrice}-E${rNavPerShare})/E${rNavPerShare}*100`);

  return cells;
}
