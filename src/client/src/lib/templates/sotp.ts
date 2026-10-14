/**
 * Sum-of-the-Parts (SOTP) -- values a multi-segment business as the total of
 * each segment valued independently (its own EBITDA x its own peer-group
 * multiple), rather than one blended multiple applied to consolidated
 * EBITDA. This matters whenever a company's segments trade at genuinely
 * different multiples in the market (a high-growth software arm bolted
 * onto a mature industrial core, for instance) -- a single consolidated
 * multiple would either overpay for the slow segment or underpay for the
 * fast one.
 */

export interface SotpSegment {
  name: string;
  ebitda: number;   // can be negative (e.g. a Corporate/Other cost-center segment)
  multiple: number; // EV/EBITDA multiple appropriate to that segment's own peer group
}

export interface SotpInputs {
  segments: SotpSegment[];
  netDebt: number;
  minorityInterest: number;
  nonOperatingAssets: number; // e.g. investments, excess real estate, equity stakes not captured in segment EBITDA
  dilutedShares: number;
}

export const DEFAULT_SOTP_INPUTS: SotpInputs = {
  segments: [
    { name: "Core Products", ebitda: 200, multiple: 9 },
    { name: "Services", ebitda: 80, multiple: 7 },
    { name: "Emerging / Growth", ebitda: 30, multiple: 14 },
    { name: "Corporate / Other", ebitda: -20, multiple: 6 },
  ],
  netDebt: 300,
  minorityInterest: 50,
  nonOperatingAssets: 40,
  dilutedShares: 100,
};

export function buildSotpModel(inputs: SotpInputs = DEFAULT_SOTP_INPUTS): Record<string, string> {
  const { segments, netDebt, minorityInterest, nonOperatingAssets, dilutedShares } = inputs;
  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  set("A1", "SUM-OF-THE-PARTS (SOTP) VALUATION");

  let row = 3;
  set(`A${row}`, "SEGMENT"); set(`C${row}`, "EBITDA ($M)"); set(`D${row}`, "MULTIPLE (x)"); set(`E${row}`, "IMPLIED EV ($M)");

  const segRows: number[] = [];
  for (const seg of segments) {
    row++;
    segRows.push(row);
    set(`A${row}`, seg.name);
    set(`C${row}`, String(seg.ebitda));
    set(`D${row}`, String(seg.multiple));
    set(`E${row}`, `=C${row}*D${row}`);
  }
  const firstSegRow = segRows[0];
  const lastSegRow = segRows[segRows.length - 1];

  const rTotalEv = row + 2; set(`A${rTotalEv}`, "TOTAL ENTERPRISE VALUE"); set(`E${rTotalEv}`, `=SUM(E${firstSegRow}:E${lastSegRow})`);

  const rNetDebt = rTotalEv + 2; set(`A${rNetDebt}`, "Less: Net Debt"); set(`E${rNetDebt}`, String(-Math.abs(netDebt)));
  const rMinority = rNetDebt + 1; set(`A${rMinority}`, "Less: Minority Interest"); set(`E${rMinority}`, String(-Math.abs(minorityInterest)));
  const rNonOp = rMinority + 1; set(`A${rNonOp}`, "Plus: Non-Operating Assets / Investments"); set(`E${rNonOp}`, String(nonOperatingAssets));

  const rEquityValue = rNonOp + 2; set(`A${rEquityValue}`, "IMPLIED EQUITY VALUE");
  set(`E${rEquityValue}`, `=E${rTotalEv}+E${rNetDebt}+E${rMinority}+E${rNonOp}`);

  const rShares = rEquityValue + 1; set(`A${rShares}`, "Diluted Shares Outstanding (M)"); set(`E${rShares}`, String(dilutedShares));

  const rValuePerShare = rShares + 1; set(`A${rValuePerShare}`, "IMPLIED VALUE PER SHARE ($)");
  set(`E${rValuePerShare}`, `=E${rEquityValue}/E${rShares}`);

  return cells;
}
