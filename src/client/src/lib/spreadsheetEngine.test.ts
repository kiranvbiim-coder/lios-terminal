import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid, parseCellRef, cellRefToString, colLettersToIndex, colIndexToLetters, translateFormula, isValidName } from "./spreadsheetEngine";

function approxEqual(a: number, b: number, tol = 1e-6) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

test("cell reference parsing round-trips", () => {
  assert.deepEqual(parseCellRef("A1"), { col: 0, row: 0 });
  assert.deepEqual(parseCellRef("Z1"), { col: 25, row: 0 });
  assert.deepEqual(parseCellRef("AA1"), { col: 26, row: 0 });
  assert.equal(cellRefToString(0, 0), "A1");
  assert.equal(cellRefToString(26, 9), "AA10");
  assert.equal(colLettersToIndex("AB"), 27);
  assert.equal(colIndexToLetters(27), "AB");
});

test("arithmetic respects standard precedence and associativity", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=2+3*4");
  assert.equal(g.getCell("A1").value, 14);
  g.setCell("A2", "=(2+3)*4");
  assert.equal(g.getCell("A2").value, 20);
  g.setCell("A3", "=2^3^2"); // right-associative: 2^(3^2) = 2^9 = 512
  assert.equal(g.getCell("A3").value, 512);
  g.setCell("A4", "=10-2-3"); // left-associative: (10-2)-3 = 5
  assert.equal(g.getCell("A4").value, 5);
});

test("cell references and recalculation propagate downstream", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "5");
  g.setCell("B1", "=A1*2");
  assert.equal(g.getCell("B1").value, 10);
  g.setCell("A1", "10");
  assert.equal(g.getCell("B1").value, 20, "B1 should recompute automatically when A1 changes");
});

test("SUM/AVERAGE/MIN/MAX over a range", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "1");
  g.setCell("A2", "2");
  g.setCell("A3", "3");
  g.setCell("B1", "=SUM(A1:A3)");
  g.setCell("B2", "=AVERAGE(A1:A3)");
  g.setCell("B3", "=MIN(A1:A3)");
  g.setCell("B4", "=MAX(A1:A3)");
  assert.equal(g.getCell("B1").value, 6);
  assert.equal(g.getCell("B2").value, 2);
  assert.equal(g.getCell("B3").value, 1);
  assert.equal(g.getCell("B4").value, 3);
});

test("IF/AND/OR/NOT boolean logic", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=IF(1,10,20)");
  g.setCell("A2", "=IF(0,10,20)");
  g.setCell("A3", "=AND(1,1,0)");
  g.setCell("A4", "=OR(0,0,1)");
  g.setCell("A5", "=NOT(0)");
  assert.equal(g.getCell("A1").value, 10);
  assert.equal(g.getCell("A2").value, 20);
  assert.equal(g.getCell("A3").value, 0);
  assert.equal(g.getCell("A4").value, 1);
  assert.equal(g.getCell("A5").value, 1);
});

test("division by zero produces #DIV/0! instead of Infinity/NaN", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=1/0");
  assert.equal(g.getCell("A1").value, null);
  assert.equal(g.getCell("A1").error, "#DIV/0!");
});

test("a direct circular reference is caught, not an infinite loop", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=B1");
  g.setCell("B1", "=A1");
  assert.equal(g.getCell("A1").error, "#CIRCULAR!");
  assert.equal(g.getCell("B1").error, "#CIRCULAR!");
});

test("an unknown function name produces #NAME? rather than crashing", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=NOTAREALFUNCTION(1)");
  assert.equal(g.getCell("A1").error, "#NAME? Unknown function NOTAREALFUNCTION");
});

test("NPV matches the standard Excel convention (first value discounted one period, not zero)", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=NPV(0.1,100,100,100)");
  // 100/1.1 + 100/1.1^2 + 100/1.1^3
  approxEqual(g.getCell("A1").value as number, 248.68519, 1e-3);
});

test("IRR is self-consistent: NPV at the computed rate is ~0", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "-100");
  g.setCell("A2", "60");
  g.setCell("A3", "60");
  g.setCell("A4", "60");
  g.setCell("B1", "=IRR(A1:A4)");
  const rate = g.getCell("B1").value as number;
  assert.ok(typeof rate === "number" && Number.isFinite(rate));
  const cashflows = [-100, 60, 60, 60];
  const npvAtRate = cashflows.reduce((sum, v, t) => sum + v / Math.pow(1 + rate, t), 0);
  approxEqual(npvAtRate, 0, 1e-4);
});

test("IRR on a simple two-flow case matches the closed-form rate", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "-100");
  g.setCell("A2", "110");
  g.setCell("B1", "=IRR(A1:A2)");
  approxEqual(g.getCell("B1").value as number, 0.10, 1e-6);
});

test("PMT matches the standard loan-payment formula", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=PMT(0.005,60,10000)");
  approxEqual(g.getCell("A1").value as number, -193.3282, 1e-2);
});

test("clearing a cell removes it from the dependency graph cleanly", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "5");
  g.setCell("B1", "=A1*2");
  g.setCell("A1", ""); // clear
  assert.equal(g.getCell("A1").raw, "");
  assert.equal(g.getCell("B1").value, 0, "A1 now resolves to null/0, not a dangling reference");
});

test("text labels are stored as-is and do not attempt numeric coercion errors", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "Revenue");
  assert.equal(g.getCell("A1").value, "Revenue");
  assert.equal(g.getCell("A1").error, null);
});

test("translateFormula shifts relative references by the fill offset", () => {
  assert.equal(translateFormula("=A1*1.1", 1, 0), "=B1*1.1"); // fill right
  assert.equal(translateFormula("=A1*1.1", 0, 1), "=A2*1.1"); // fill down
  assert.equal(translateFormula("=C5+D5", 1, 1), "=D6+E6");
});

test("translateFormula leaves absolute ($) parts of a reference untouched", () => {
  assert.equal(translateFormula("=$A$1*B1", 1, 1), "=$A$1*C2"); // fully absolute anchor
  assert.equal(translateFormula("=A$1*$B1", 1, 1), "=B$1*$B2"); // mixed refs: only the non-$ axis moves
});

test("translateFormula shifts every reference inside a range and inside function calls", () => {
  assert.equal(translateFormula("=SUM(A1:A5)", 1, 0), "=SUM(B1:B5)");
  assert.equal(translateFormula("=NPV(B1,C1:C5)", 0, 1), "=NPV(B2,C2:C6)");
});

test("translateFormula returns literal (non-formula) cells unchanged -- fill copies literals as-is", () => {
  assert.equal(translateFormula("42", 1, 1), "42");
  assert.equal(translateFormula("Revenue", 1, 1), "Revenue");
});

test("translateFormula throws #REF! when a shift would move a reference off the grid", () => {
  assert.throws(() => translateFormula("=A1*2", -1, 0), /#REF!/);
  assert.throws(() => translateFormula("=A1*2", 0, -1), /#REF!/);
});

test("SpreadsheetGrid.fillFormula fills a formula across a row, each cell computing its own translated result", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10");
  g.setCell("A2", "20");
  g.setCell("A3", "30");
  g.setCell("B1", "=A1*2");
  g.fillFormula("B1", ["B2", "B3"]);
  assert.equal(g.getCell("B2").raw, "=A2*2");
  assert.equal(g.getCell("B3").raw, "=A3*2");
  assert.equal(g.getCell("B2").value, 40);
  assert.equal(g.getCell("B3").value, 60);
});

test("SpreadsheetGrid.fillFormula keeps an absolute-anchored reference fixed across every filled cell", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "2"); // growth-rate style assumption, meant to stay fixed
  g.setCell("B1", "100");
  g.setCell("B2", "200");
  g.setCell("C1", "=B1*$A$1");
  g.fillFormula("C1", ["C2"]);
  assert.equal(g.getCell("C2").raw, "=B2*$A$1");
  assert.equal(g.getCell("C2").value, 400);
});

test("isValidName accepts identifier-shaped names and rejects things that would collide with real syntax", () => {
  assert.equal(isValidName("TaxRate"), true);
  assert.equal(isValidName("Revenue_2025"), true);
  assert.equal(isValidName("A1"), false, "looks like a cell ref, must be rejected");
  assert.equal(isValidName("AB100"), false, "looks like a cell ref, must be rejected");
  assert.equal(isValidName("TRUE"), false);
  assert.equal(isValidName("1Revenue"), false, "can't start with a digit");
  assert.equal(isValidName("Tax Rate"), false, "no spaces");
});

test("named ranges: a defined name resolves inside a formula, and the formula bar keeps showing the name, not the resolved ref", () => {
  const g = new SpreadsheetGrid();
  g.setCell("C8", "21"); // tax rate %, as a plain number
  g.defineName("TaxRate", "$C$8");
  g.setCell("D1", "=100*TaxRate/100");
  assert.equal(g.getCell("D1").raw, "=100*TaxRate/100", "raw formula text is unchanged -- self-documenting");
  assert.equal(g.getCell("D1").value, 21);
});

test("named ranges: redefining a name propagates to every formula that already used it, live", () => {
  const g = new SpreadsheetGrid();
  g.setCell("C8", "21");
  g.setCell("C9", "30");
  g.defineName("TaxRate", "$C$8");
  g.setCell("D1", "=100*TaxRate/100");
  assert.equal(g.getCell("D1").value, 21);
  g.defineName("TaxRate", "$C$9"); // redefine to point at a different cell
  assert.equal(g.getCell("D1").value, 30, "existing formula re-resolves against the new target without being retyped");
});

test("named ranges: a name still updates live when the cell it points to changes (it's a real reference, not a frozen snapshot)", () => {
  const g = new SpreadsheetGrid();
  g.setCell("C8", "21");
  g.defineName("TaxRate", "$C$8");
  g.setCell("D1", "=100*TaxRate/100");
  assert.equal(g.getCell("D1").value, 21);
  g.setCell("C8", "25");
  assert.equal(g.getCell("D1").value, 25);
});

test("named ranges: a name matching a range resolves inside SUM the same as typing the range directly", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10");
  g.setCell("A2", "20");
  g.setCell("A3", "30");
  g.defineName("CostBucket", "A1:A3");
  g.setCell("B1", "=SUM(CostBucket)");
  assert.equal(g.getCell("B1").value, 60);
});

test("named ranges: a defined name never shadows an actual function call, even if the name matches a function's name", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "5");
  g.setCell("A2", "7");
  g.setCell("Z1", "100");
  g.defineName("SUM", "Z1"); // deliberately colliding with a real function name
  g.setCell("B1", "=SUM(A1:A2)"); // still parsed as the SUM(...) function call
  assert.equal(g.getCell("B1").value, 12);
  g.setCell("B2", "=SUM+1"); // bare "SUM", not a call -- resolves through the named range instead
  assert.equal(g.getCell("B2").value, 101);
});

test("formula auditing: getPrecedents lists every cell a formula directly references", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10");
  g.setCell("A2", "20");
  g.setCell("B1", "=A1+A2");
  assert.deepEqual(new Set(g.getPrecedents("B1")), new Set(["A1", "A2"]));
  assert.deepEqual(g.getPrecedents("A1"), [], "a literal has no precedents");
});

test("formula auditing: getDependents lists every cell that references the given cell, including transitively unrelated branches", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10");
  g.setCell("B1", "=A1*2");
  g.setCell("C1", "=A1+5");
  g.setCell("D1", "=B1"); // depends on B1, not directly on A1
  assert.deepEqual(new Set(g.getDependents("A1")), new Set(["B1", "C1"]));
  assert.deepEqual(g.getDependents("B1"), ["D1"]);
  assert.deepEqual(g.getDependents("D1"), [], "nothing depends on a leaf cell");
});

test("formula auditing: getDependents updates when a formula is edited to no longer reference a cell", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10");
  g.setCell("B1", "=A1*2");
  assert.deepEqual(g.getDependents("A1"), ["B1"]);
  g.setCell("B1", "=5"); // no longer references A1
  assert.deepEqual(g.getDependents("A1"), []);
});

test("formula auditing: getErrorCells finds every flagged cell across the sheet, including a circular-reference cycle", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=B1"); // circular: A1 -> B1 -> A1
  g.setCell("B1", "=A1");
  g.setCell("C1", "=UNKNOWNFUNC(1)");
  g.setCell("D1", "42"); // fine, should not be flagged
  const flagged = g.getErrorCells();
  const refs = flagged.map((f) => f.ref).sort();
  assert.deepEqual(refs, ["A1", "B1", "C1"]);
});

// ─── Expanded function library ────────────────────────────────────────────

function makeCompsTable(g: SpreadsheetGrid) {
  // A tiny 4-row x 3-col lookup table: Ticker | Sector | EV/EBITDA, sorted by ticker for approximate-match tests.
  const rows: [string, string, number][] = [
    ["AAPL", "Technology", 18.2],
    ["JPM", "Financials", 11.4],
    ["MSFT", "Technology", 22.1],
    ["XOM", "Energy", 6.8],
  ];
  rows.forEach(([ticker, sector, multiple], i) => {
    g.setCell(`A${i + 1}`, ticker);
    g.setCell(`B${i + 1}`, sector);
    g.setCell(`C${i + 1}`, String(multiple));
  });
}

test("VLOOKUP: exact match (FALSE) finds the row and returns the requested column", () => {
  const g = new SpreadsheetGrid();
  makeCompsTable(g);
  g.setCell("E1", '=VLOOKUP("MSFT",A1:C4,3,FALSE)');
  approxEqual(g.getCell("E1").value as number, 22.1);
  g.setCell("E2", '=VLOOKUP("MSFT",A1:C4,2,FALSE)');
  assert.equal(g.getCell("E2").value, "Technology");
});

test("VLOOKUP: no match under exact mode raises #N/A, not a silent wrong value", () => {
  const g = new SpreadsheetGrid();
  makeCompsTable(g);
  g.setCell("E1", '=VLOOKUP("TSLA",A1:C4,3,FALSE)');
  assert.equal(g.getCell("E1").error, "#N/A");
});

test("HLOOKUP: transposed VLOOKUP, searches the first row and returns from the given row index", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "Q1"); g.setCell("B1", "Q2"); g.setCell("C1", "Q3");
  g.setCell("A2", "100"); g.setCell("B2", "150"); g.setCell("C2", "175");
  g.setCell("D1", '=HLOOKUP("Q2",A1:C2,2,FALSE)');
  approxEqual(g.getCell("D1").value as number, 150);
});

test("INDEX: 2D range indexed by (row, col); a single-row range indexes directly across it when col is omitted", () => {
  const g = new SpreadsheetGrid();
  makeCompsTable(g);
  g.setCell("E1", "=INDEX(A1:C4,3,2)"); // row 3 = MSFT row, col 2 = Sector
  assert.equal(g.getCell("E1").value, "Technology");
  g.setCell("E2", "=INDEX(A1:C1,2)"); // single row -- 2nd item across it
  assert.equal(g.getCell("E2").value, "Technology");
});

test("MATCH: exact (0) finds the position; approximate (1) finds the largest value <= target in an ascending list", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10"); g.setCell("A2", "20"); g.setCell("A3", "30");
  g.setCell("B1", "=MATCH(20,A1:A3,0)");
  assert.equal(g.getCell("B1").value, 2);
  g.setCell("B2", "=MATCH(25,A1:A3,1)"); // no exact 25 -- lands on 20 (position 2)
  assert.equal(g.getCell("B2").value, 2);
});

test("XLOOKUP: returns the matched value from a separate return range, or the if_not_found default", () => {
  const g = new SpreadsheetGrid();
  makeCompsTable(g);
  g.setCell("E1", '=XLOOKUP("XOM",A1:A4,C1:C4)');
  approxEqual(g.getCell("E1").value as number, 6.8);
  g.setCell("E2", '=XLOOKUP("TSLA",A1:A4,C1:C4,"n/a")');
  assert.equal(g.getCell("E2").value, "n/a");
});

test("CHOOSE: 1-indexed selection among a fixed list of values", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", '=CHOOSE(2,"Base","Bull","Bear")');
  assert.equal(g.getCell("A1").value, "Bull");
});

test("date functions: DATE/YEAR/MONTH/DAY round-trip, and EDATE/EOMONTH shift correctly across a year boundary", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=DATE(2026,3,15)");
  g.setCell("B1", "=YEAR(A1)"); g.setCell("B2", "=MONTH(A1)"); g.setCell("B3", "=DAY(A1)");
  assert.equal(g.getCell("B1").value, 2026);
  assert.equal(g.getCell("B2").value, 3);
  assert.equal(g.getCell("B3").value, 15);

  g.setCell("C1", "=EDATE(A1,11)"); // 2026-03-15 + 11mo -> 2027-02-15
  g.setCell("C2", "=YEAR(C1)"); g.setCell("C3", "=MONTH(C1)"); g.setCell("C4", "=DAY(C1)");
  assert.equal(g.getCell("C2").value, 2027);
  assert.equal(g.getCell("C3").value, 2);
  assert.equal(g.getCell("C4").value, 15);

  g.setCell("D1", "=EOMONTH(A1,0)"); // last day of March 2026
  g.setCell("D2", "=DAY(D1)"); g.setCell("D3", "=MONTH(D1)");
  assert.equal(g.getCell("D2").value, 31);
  assert.equal(g.getCell("D3").value, 3);
});

test("DATEDIF: day/month/year differences match the standard convention (month/year require full elapsed periods)", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=DATE(2024,1,15)");
  g.setCell("A2", "=DATE(2026,3,10)"); // just short of 2y2m -- day (10) < start day (15)
  g.setCell("B1", '=DATEDIF(A1,A2,"D")');
  g.setCell("B2", '=DATEDIF(A1,A2,"M")');
  g.setCell("B3", '=DATEDIF(A1,A2,"Y")');
  assert.equal(g.getCell("B2").value, 25); // 2y1m full, not 2y2m, since day 10 < 15
  assert.equal(g.getCell("B3").value, 2);
  assert.ok((g.getCell("B1").value as number) > 700);
});

test("NETWORKDAYS: excludes weekends and any explicit holiday range", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=DATE(2026,3,2)"); // Monday
  g.setCell("A2", "=DATE(2026,3,6)"); // Friday -- 5 weekdays, no holidays
  g.setCell("B1", "=NETWORKDAYS(A1,A2)");
  assert.equal(g.getCell("B1").value, 5);
  g.setCell("H1", "=DATE(2026,3,4)"); // Wednesday, marked as a holiday
  g.setCell("B2", "=NETWORKDAYS(A1,A2,H1:H1)");
  assert.equal(g.getCell("B2").value, 4);
});

test("text functions: LEFT/RIGHT/MID/LEN/TRIM/UPPER/LOWER/PROPER/SUBSTITUTE all behave as their Excel namesakes", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "Reliance Industries");
  g.setCell("B1", "=LEFT(A1,8)"); assert.equal(g.getCell("B1").value, "Reliance");
  g.setCell("B2", "=RIGHT(A1,10)"); assert.equal(g.getCell("B2").value, "Industries");
  g.setCell("B3", "=MID(A1,10,4)"); assert.equal(g.getCell("B3").value, "Indu");
  g.setCell("B4", "=LEN(A1)"); assert.equal(g.getCell("B4").value, 19);
  g.setCell("C1", "  spaced   out  ");
  g.setCell("B5", "=TRIM(C1)"); assert.equal(g.getCell("B5").value, "spaced out");
  g.setCell("B6", '=UPPER("abc")'); assert.equal(g.getCell("B6").value, "ABC");
  g.setCell("B7", '=LOWER("ABC")'); assert.equal(g.getCell("B7").value, "abc");
  g.setCell("B8", '=PROPER("net income")'); assert.equal(g.getCell("B8").value, "Net Income");
  g.setCell("B9", '=SUBSTITUTE("2024-01-01","-","/")'); assert.equal(g.getCell("B9").value, "2024/01/01");
});

test("TEXT: formats a number as percent and as thousands-separated currency", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", '=TEXT(0.156,"0.0%")');
  assert.equal(g.getCell("A1").value, "15.6%");
  g.setCell("A2", '=TEXT(1234567.5,"$#,##0.00")');
  assert.equal(g.getCell("A2").value, "$1,234,567.50");
});

test("SUMIF/COUNTIF/AVERAGEIF: single-condition conditional aggregation with a numeric criteria", () => {
  const g = new SpreadsheetGrid();
  makeCompsTable(g);
  g.setCell("E1", '=SUMIF(B1:B4,"Technology",C1:C4)');
  approxEqual(g.getCell("E1").value as number, 18.2 + 22.1);
  g.setCell("E2", '=COUNTIF(B1:B4,"Technology")');
  assert.equal(g.getCell("E2").value, 2);
  g.setCell("E3", "=AVERAGEIF(C1:C4,\">10\")");
  approxEqual(g.getCell("E3").value as number, (18.2 + 11.4 + 22.1) / 3);
});

test("SUMIFS/COUNTIFS/MAXIFS/MINIFS: multi-condition aggregation across paired criteria ranges", () => {
  const g = new SpreadsheetGrid();
  makeCompsTable(g);
  // Technology sector AND EV/EBITDA > 20 -- only MSFT (22.1) qualifies.
  g.setCell("E1", '=SUMIFS(C1:C4,B1:B4,"Technology",C1:C4,">20")');
  approxEqual(g.getCell("E1").value as number, 22.1);
  g.setCell("E2", '=COUNTIFS(B1:B4,"Technology",C1:C4,">20")');
  assert.equal(g.getCell("E2").value, 1);
  g.setCell("E3", '=MAXIFS(C1:C4,B1:B4,"Technology")');
  approxEqual(g.getCell("E3").value as number, 22.1);
  g.setCell("E4", '=MINIFS(C1:C4,B1:B4,"Technology")');
  approxEqual(g.getCell("E4").value as number, 18.2);
});

test("IF no longer eagerly evaluates the untaken branch -- IF(A1<>0, 1/A1, 0) does not #DIV/0! when A1 is 0", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "0");
  g.setCell("B1", "=IF(A1<>0,1/A1,0)");
  assert.equal(g.getCell("B1").value, 0);
  assert.equal(g.getCell("B1").error, null);
  g.setCell("A1", "4");
  assert.equal(g.getCell("B1").value, 0.25);
});

test("IFERROR/IFNA suppress an error from evaluating their first argument, without needing the error to already be a stored value", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "0");
  g.setCell("B1", '=IFERROR(10/A1,"n/a")');
  assert.equal(g.getCell("B1").value, "n/a");
  g.setCell("A1", "5");
  assert.equal(g.getCell("B1").value, 2);

  g.setCell("C1", "x");
  g.setCell("D1", '=VLOOKUP(C1,A1:A1,1,FALSE)'); // guaranteed #N/A -- A1 is "5", not "x"
  g.setCell("D2", '=IFNA(D1,"missing")');
  assert.equal(g.getCell("D2").value, "missing");
});

test("ISERROR/ISNA/ISBLANK/ISNUMBER/ISTEXT correctly classify their argument without propagating an underlying error", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=1/0");
  g.setCell("B1", "=ISERROR(A1)"); assert.equal(g.getCell("B1").value, 1);
  g.setCell("B2", "=ISBLANK(Z99)"); assert.equal(g.getCell("B2").value, 1); // never-set cell
  g.setCell("C1", "42");
  g.setCell("B3", "=ISNUMBER(C1)"); assert.equal(g.getCell("B3").value, 1);
  g.setCell("B4", "=ISTEXT(C1)"); assert.equal(g.getCell("B4").value, 0);
  g.setCell("C2", "hello");
  g.setCell("B5", "=ISTEXT(C2)"); assert.equal(g.getCell("B5").value, 1);
});

test("financial: XIRR/XNPV on real-world irregular-date cash flows match the closed-form annualized rate", () => {
  const g = new SpreadsheetGrid();
  // -1000 on day 0, +1100 exactly 365 days later (2025 is not a leap year)
  // -> a clean 10% annual return, an easy closed-form check.
  g.setCell("A1", "=DATE(2025,1,1)"); g.setCell("A2", "=DATE(2026,1,1)");
  g.setCell("B1", "-1000"); g.setCell("B2", "1100");
  g.setCell("C1", "=XIRR(B1:B2,A1:A2)");
  approxEqual(g.getCell("C1").value as number, 0.10, 1e-3);
  g.setCell("C2", "=XNPV(0.10,B1:B2,A1:A2)");
  approxEqual(g.getCell("C2").value as number, 0, 1e-6);
});

test("financial: FV/PV/NPER/RATE are mutually consistent (solving one for the value that produced the others)", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=FV(0.05,10,-100,-1000)");
  const futureValue = g.getCell("A1").value as number;
  approxEqual(futureValue, 1000 * 1.05 ** 10 + 100 * ((1.05 ** 10 - 1) / 0.05), 1e-6);

  g.setCell("A2", "=PV(0.05,10,-100,0)");
  approxEqual(g.getCell("A2").value as number, 100 * ((1 - 1.05 ** -10) / 0.05), 1e-6);
});

test("financial: SLN/DDB/SYD depreciation schedules sum a $10k asset (no salvage, 5yr life) down toward zero", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=SLN(10000,0,5)");
  approxEqual(g.getCell("A1").value as number, 2000);
  g.setCell("B1", "=DDB(10000,0,5,1)");
  approxEqual(g.getCell("B1").value as number, 4000); // 2/5 rate on full cost in year 1
  g.setCell("C1", "=SYD(10000,0,5,1)");
  approxEqual(g.getCell("C1").value as number, 10000 * 5 / 15); // sum-of-years-digits = 15
});

test("statistics: STDEV/VAR/MEDIAN/CORREL/PERCENTILE/LARGE/SMALL on a known small dataset", () => {
  const g = new SpreadsheetGrid();
  [2, 4, 4, 4, 5, 5, 7, 9].forEach((v, i) => g.setCell(`A${i + 1}`, String(v)));
  g.setCell("B1", "=STDEV(A1:A8)");
  approxEqual(g.getCell("B1").value as number, 2.13809, 1e-4); // sample stdev of this classic textbook dataset
  g.setCell("B2", "=MEDIAN(A1:A8)");
  approxEqual(g.getCell("B2").value as number, 4.5);
  g.setCell("B3", "=LARGE(A1:A8,2)");
  approxEqual(g.getCell("B3").value as number, 7);
  g.setCell("B4", "=SMALL(A1:A8,2)");
  approxEqual(g.getCell("B4").value as number, 4);
});

test("statistics: TREND/FORECAST fit a perfect line (y=2x) exactly", () => {
  const g = new SpreadsheetGrid();
  [1, 2, 3, 4].forEach((x, i) => { g.setCell(`A${i + 1}`, String(x)); g.setCell(`B${i + 1}`, String(x * 2)); });
  g.setCell("C1", "=FORECAST(10,B1:B4,A1:A4)");
  approxEqual(g.getCell("C1").value as number, 20, 1e-6);
  g.setCell("C2", "=TREND(B1:B4,A1:A4,5)");
  approxEqual(g.getCell("C2").value as number, 10, 1e-6);
});

// ─── Number formatting ─────────────────────────────────────────────────

test("number formats: a cell's format is independent of its value and survives clearing the content", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "0.156");
  g.setFormat("A1", "0.0%");
  assert.equal(g.getFormat("A1"), "0.0%");
  g.setCell("A1", ""); // clear content -- Excel keeps the format for whatever gets typed next
  assert.equal(g.getFormat("A1"), "0.0%");
  g.setFormat("A1", null); // explicit clear
  assert.equal(g.getFormat("A1"), null);
});

test("number formats: fillFormula copies the source cell's format onto every filled cell, same as Excel's fill handle", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10"); g.setCell("A2", "20"); g.setCell("A3", "30");
  g.setCell("B1", "=A1*0.1");
  g.setFormat("B1", "0.0%");
  g.fillFormula("B1", ["B2", "B3"]);
  assert.equal(g.getFormat("B2"), "0.0%");
  assert.equal(g.getFormat("B3"), "0.0%");
});

// ─── Structural edits: insert/delete row/column ─────────────────────────

test("insertRows: content at and below the insertion point shifts down by the inserted count; content above is untouched", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "Header");
  g.setCell("A2", "Row2");
  g.setCell("A3", "Row3");
  g.insertRows(1, 1); // insert 1 row at row index 1 (0-based) -- i.e. before display-row 2
  assert.equal(g.getCell("A1").raw, "Header"); // above the insert point -- unmoved
  assert.equal(g.getCell("A2").raw, ""); // the newly-opened blank row
  assert.equal(g.getCell("A3").raw, "Row2"); // shifted down 1
  assert.equal(g.getCell("A4").raw, "Row3");
});

test("insertRows: a formula referencing a cell that shifted is rewritten to follow it, whether the reference is relative or absolute", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10");
  g.setCell("A5", "20");
  g.setCell("B1", "=A1+$A$5"); // A5 will shift to A6
  g.insertRows(2, 1); // insert before row index 2 (display row 3) -- A5 (index 4) shifts to A6
  assert.equal(g.getCell("A6").raw, "20");
  assert.equal(g.getCell("B1").raw, "=A1+$A$6", "both the relative and the $-absolute reference follow the moved cell -- structural edits aren't fill/copy, $ has no bearing here");
  assert.equal(g.getCell("B1").value, 30);
});

test("deleteRows: content below the deleted band shifts up; a formula referencing a cell inside the deleted band becomes a #REF! text marker", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10");
  g.setCell("A2", "20"); // this row gets deleted
  g.setCell("A3", "30");
  g.setCell("B1", "=A2*2"); // row 0, directly references the doomed row -- itself unaffected structurally
  g.setCell("B3", "=A3+1"); // row 2, references content that will shift up into row 1
  g.deleteRows(1, 1); // delete row index 1 (display row 2) -- this also removes B1's sibling on that row, but B1 itself is on row 0
  assert.equal(g.getCell("A2").raw, "30"); // A3 shifted up into A2
  assert.equal(g.getCell("B1").raw, "#REF!");
  assert.equal(g.getCell("B2").raw, "=A2+1", "B3 shifted up to B2, and its reference followed A3 as it shifted up to A2");
  assert.equal(g.getCell("B2").value, 31);
});

test("insertCols/deleteCols: same shifting behavior as rows, applied to the column axis", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "1"); g.setCell("B1", "2"); g.setCell("C1", "3");
  g.setCell("D1", "=A1+C1");
  g.insertCols(1, 1); // insert before column index 1 (column B)
  assert.equal(g.getCell("A1").raw, "1"); // untouched
  assert.equal(g.getCell("C1").raw, "2"); // B shifted to C
  assert.equal(g.getCell("D1").raw, "3"); // C shifted to D
  assert.equal(g.getCell("E1").raw, "=A1+D1"); // the formula's C-reference followed to D

  g.deleteCols(1, 1); // delete the just-inserted blank column B, restoring the original layout
  assert.equal(g.getCell("B1").raw, "2");
  assert.equal(g.getCell("D1").raw, "=A1+C1");
});

test("insertRows/deleteRows: a named range's target follows the shift, so formulas using the name keep resolving correctly", () => {
  const g = new SpreadsheetGrid();
  g.setCell("C8", "21");
  g.defineName("TaxRate", "$C$8");
  g.setCell("D1", "=100*TaxRate/100");
  assert.equal(g.getCell("D1").value, 21);

  g.insertRows(0, 2); // insert 2 rows above everything -- C8 shifts to C10
  assert.equal(g.getNames().get("TAXRATE"), "$C$10");
  assert.equal(g.getCell("D3").value, 21, "the formula (also shifted, from D1 to D3) still resolves through the name to its new target");
});

test("insertRows/deleteRows: a cell's format follows it when its position shifts", () => {
  const g = new SpreadsheetGrid();
  g.setCell("B2", "0.5");
  g.setFormat("B2", "0.0%");
  g.insertRows(0, 1);
  assert.equal(g.getFormat("B3"), "0.0%");
  assert.equal(g.getFormat("B2"), null);
});

// ─── Iterative calculation & the circularity breaker ────────────────────

test("iterative calculation is OFF by default -- a circular reference still fails loudly as #CIRCULAR!, not a silently-wrong number", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=B1");
  g.setCell("B1", "=A1");
  assert.equal(g.getCell("A1").error, "#CIRCULAR!");
  assert.equal(g.getCell("B1").error, "#CIRCULAR!");
});

test("iterative calculation: a self-referencing formula (X = 100 + 0.5X) converges to its closed-form fixed point (X = 200)", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  g.setCell("A1", "=100+0.5*A1");
  assert.equal(g.getCell("A1").error, null);
  approxEqual(g.getCell("A1").value as number, 200, 1e-2);
});

test("iterative calculation: a real LBO-style circular debt schedule (interest on the average of beginning/ending balance) converges to the correct ending debt", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  g.setCell("A1", "1000"); // beginning debt
  g.setCell("A2", "0.08"); // interest rate
  g.setCell("A3", "300");  // EBIT
  // The circular chain: EndingDebt -> AvgDebt -> Interest -> Sweep -> EndingDebt.
  g.setCell("A5", "=(A1+A4)/2");   // avg debt balance
  g.setCell("A6", "=A5*A2");       // interest expense on the average balance
  g.setCell("A7", "=A3-A6");       // cash sweep = EBIT - interest (simplified: no tax/capex/NWC)
  g.setCell("A4", "=A1-A7");       // ending debt = beginning - sweep

  // Closed form: E = 1000 - 300 + ((1000+E)/2)*0.08 -> 0.96E = 740 -> E = 770.8333...
  assert.equal(g.getCell("A4").error, null);
  approxEqual(g.getCell("A4").value as number, 740 / 0.96, 1e-1);
});

test("iterative calculation: turning it ON retroactively re-resolves cells that are already showing #CIRCULAR!, without needing to retype the formulas", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "=100+0.5*A1"); // iterative mode still off -- this is #CIRCULAR!
  assert.equal(g.getCell("A1").error, "#CIRCULAR!");
  g.setIterativeMode(true);
  assert.equal(g.getCell("A1").error, null);
  approxEqual(g.getCell("A1").value as number, 200, 1e-2);
});

test("iterative calculation: a genuinely diverging formula (X = 2X + 1, unbounded growth) reports #DIVERGED! instead of returning a runaway number", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true, 20, 0.001); // small iteration cap so the test stays fast
  g.setCell("A1", "=2*A1+1");
  assert.ok(g.getCell("A1").error?.startsWith("#DIVERGED!"));
  assert.equal(g.getCell("A1").value, null);
});

test("iterative calculation: turning it back OFF makes a new circular formula fail loudly again", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  g.setCell("A1", "=100+0.5*A1");
  approxEqual(g.getCell("A1").value as number, 200, 1e-2);
  g.setIterativeMode(false);
  g.setCell("B1", "=B1+1"); // a fresh circular formula entered after switching back off
  assert.equal(g.getCell("B1").error, "#CIRCULAR!");
});
