/**
 * Precedent Transactions (Transaction Comps) -- values a target off what
 * ACQUIRERS have actually paid for comparable companies (EV/Revenue and
 * EV/EBITDA multiples baked into real M&A deals), rather than off where
 * comparable companies currently trade in the public market. Transaction
 * multiples run structurally higher than trading comps because they embed
 * a control premium -- the amount a buyer pays for the right to control
 * the target's strategy and cash flows outright -- so this method is the
 * standard cross-check specifically for M&A and take-private valuations,
 * not a general-purpose substitute for trading comps.
 */

export interface PrecedentDeal {
  target: string;
  acquirer: string;
  dealEv: number;
  targetRevenue: number;
  targetEbitda: number;
}

export interface TransactionCompsInputs {
  deals: PrecedentDeal[];
  ownRevenue: number; // the company actually being valued
  ownEbitda: number;
  netDebt: number;
}

// Names left blank rather than named ("Target A" / "Acquirer A") -- that
// pattern paired with specific-looking dollar figures reads as a real
// transaction pulled from somewhere, when it isn't (same reasoning as the
// M&A desk's precedent-transactions table, which starts empty for the same
// reason). The dollar figures themselves stay as round illustrative
// placeholders (same spirit as the LBO template's entryEbit: 100) so the
// template's formulas compute a real, non-degenerate example on creation
// instead of a wall of #DIV/0! -- the analyst is expected to overwrite both
// the blank names and the placeholder numbers with real deals.
export const DEFAULT_TRANSACTION_COMPS_INPUTS: TransactionCompsInputs = {
  deals: [
    { target: "", acquirer: "", dealEv: 1200, targetRevenue: 400, targetEbitda: 150 },
    { target: "", acquirer: "", dealEv: 900, targetRevenue: 300, targetEbitda: 100 },
    { target: "", acquirer: "", dealEv: 2000, targetRevenue: 500, targetEbitda: 200 },
    { target: "", acquirer: "", dealEv: 600, targetRevenue: 250, targetEbitda: 75 },
    { target: "", acquirer: "", dealEv: 1500, targetRevenue: 450, targetEbitda: 180 },
  ],
  ownRevenue: 350,
  ownEbitda: 120,
  netDebt: 100,
};

export function buildTransactionCompsModel(inputs: TransactionCompsInputs = DEFAULT_TRANSACTION_COMPS_INPUTS): Record<string, string> {
  const { deals, ownRevenue, ownEbitda, netDebt } = inputs;
  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  set("A1", "PRECEDENT TRANSACTIONS (TRANSACTION COMPS)");

  let row = 3;
  set(`A${row}`, "TARGET"); set(`B${row}`, "ACQUIRER"); set(`C${row}`, "DEAL EV ($M)");
  set(`D${row}`, "TARGET REVENUE ($M)"); set(`E${row}`, "TARGET EBITDA ($M)");
  set(`F${row}`, "EV/REVENUE (x)"); set(`G${row}`, "EV/EBITDA (x)");

  const dealRows: number[] = [];
  for (const d of deals) {
    row++;
    dealRows.push(row);
    set(`A${row}`, d.target);
    set(`B${row}`, d.acquirer);
    set(`C${row}`, String(d.dealEv));
    set(`D${row}`, String(d.targetRevenue));
    set(`E${row}`, String(d.targetEbitda));
    set(`F${row}`, `=C${row}/D${row}`);
    set(`G${row}`, `=C${row}/E${row}`);
  }
  const firstDealRow = dealRows[0];
  const lastDealRow = dealRows[dealRows.length - 1];

  const rMean = row + 2; set(`A${rMean}`, "Mean");
  set(`F${rMean}`, `=AVERAGE(F${firstDealRow}:F${lastDealRow})`); set(`G${rMean}`, `=AVERAGE(G${firstDealRow}:G${lastDealRow})`);
  const rMedian = rMean + 1; set(`A${rMedian}`, "Median");
  set(`F${rMedian}`, `=MEDIAN(F${firstDealRow}:F${lastDealRow})`); set(`G${rMedian}`, `=MEDIAN(G${firstDealRow}:G${lastDealRow})`);
  const rMin = rMedian + 1; set(`A${rMin}`, "Min");
  set(`F${rMin}`, `=MIN(F${firstDealRow}:F${lastDealRow})`); set(`G${rMin}`, `=MIN(G${firstDealRow}:G${lastDealRow})`);
  const rMax = rMin + 1; set(`A${rMax}`, "Max");
  set(`F${rMax}`, `=MAX(F${firstDealRow}:F${lastDealRow})`); set(`G${rMax}`, `=MAX(G${firstDealRow}:G${lastDealRow})`);

  const rImplied = rMax + 2; set(`A${rImplied}`, "IMPLIED VALUATION -- APPLYING MEDIAN MULTIPLES");
  const rOwnRevenue = rImplied + 1; set(`A${rOwnRevenue}`, "Target Company Revenue ($M)"); set(`C${rOwnRevenue}`, String(ownRevenue));
  const rOwnEbitda = rOwnRevenue + 1; set(`A${rOwnEbitda}`, "Target Company EBITDA ($M)"); set(`C${rOwnEbitda}`, String(ownEbitda));

  const rImpliedEvRevenue = rOwnEbitda + 2; set(`A${rImpliedEvRevenue}`, "Implied EV -- Revenue Basis");
  set(`C${rImpliedEvRevenue}`, `=C${rOwnRevenue}*F${rMedian}`);
  const rImpliedEvEbitda = rImpliedEvRevenue + 1; set(`A${rImpliedEvEbitda}`, "Implied EV -- EBITDA Basis");
  set(`C${rImpliedEvEbitda}`, `=C${rOwnEbitda}*G${rMedian}`);
  const rImpliedEvBlended = rImpliedEvEbitda + 1; set(`A${rImpliedEvBlended}`, "Implied EV -- Blended Average");
  set(`C${rImpliedEvBlended}`, `=AVERAGE(C${rImpliedEvRevenue}:C${rImpliedEvEbitda})`);

  const rNetDebt = rImpliedEvBlended + 2; set(`A${rNetDebt}`, "Less: Net Debt"); set(`C${rNetDebt}`, String(-Math.abs(netDebt)));
  const rEquity = rNetDebt + 1; set(`A${rEquity}`, "IMPLIED EQUITY VALUE"); set(`C${rEquity}`, `=C${rImpliedEvBlended}+C${rNetDebt}`);

  return cells;
}
