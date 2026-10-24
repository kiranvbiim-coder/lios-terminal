import test from "node:test";
import assert from "node:assert/strict";
import { chatInlineText, chatTableToTsv, copyChatTable, safeTableCell } from "./chatTableCopy";
import { parseChatMarkdown, type Inline } from "./chatMarkdown";
const table = (source: string) => {
  const value = parseChatMarkdown(source).find(block => block.t === "table");
  assert.ok(value && value.t === "table");
  return value;
};

test("WS-23 copies the actual table headers, cell order and delimiters without Markdown syntax", () => {
  const value = table("| Name | FY24 |\n|:---|---:|\n| Revenue | 1,450 |\n| EPS | 3.21 |");
  assert.equal(chatTableToTsv(value), "Name\tFY24\nRevenue\t1,450\nEPS\t3.21");
});
test("WS-23 bold, links, code, and an unresolved citation copy only visible text", () => {
  const text: Inline[] = [
    {t:"strong",c:[{t:"text",v:"Income"}]},
    {t:"text",v:" "},
    {t:"link",href:"https://example.test",c:[{t:"text",v:"source"}]},
    {t:"text",v:" "},
    {t:"code",v:"x < y"},
    {t:"text",v:" "},
    {t:"cite",raw:"[7]",nums:[7],name:null},
  ];
  assert.equal(chatInlineText(text),"Income source x < y [7]");
});
test("WS-23 never injects an Excel/Sheets formula from response cells", () => {
  for (const value of ["=HYPERLINK(\"https://evil.test\")", "+SUM(1,1)", "@SUM(1,1)", "-cmd|' /C calc'!A0"]) {
    assert.equal(safeTableCell([{t:"text",v:value}]),"'"+value);
  }
});
test("WS-23 benign negative finance figures remain actual signed values", () => {
  for (const value of ["-123", "-12.5", "-8.2%", "0", "1,500", "23%"]) {
    assert.equal(safeTableCell([{t:"text",v:value}]),value);
  }
});
test("WS-23 leading control bytes and spreadsheet payload whitespace are sanitized", () => {
  assert.equal(safeTableCell([{t:"text",v:"\t\n =2+2\r"}]),"'=2+2");
  assert.equal(safeTableCell([{t:"text",v:"a\tsecret\nnext"}]),"a secret next");
});
test("WS-23 formula safety applies to model-generated column headings", () => {
  const value=table("| =HYPERLINK | Data |\n|---|---|\n| Row | 2 |");
  assert.equal(chatTableToTsv(value).split("\n")[0],"'=HYPERLINK\tData");
});
test("WS-23 table cells with no corresponding body value copy as empty cells, not merged rows", () => {
  const value=table("| Symbol | Price | Change |\n|---|---|---|\n| MSFT | 45 |");
  assert.equal(chatTableToTsv(value),"Symbol\tPrice\tChange\nMSFT\t45\t");
});
test("WS-23 clipboard writes exact safe TSV and only then returns success", async () => {
  const value=table("| A | B |\n|---|---|\n| -5 | =2+2 |");
  let written: string|undefined;
  assert.equal(await copyChatTable(async content=>{written=content;},value),true);
  assert.equal(written,"A\tB\n-5\t'=2+2");
});
test("WS-23 unsupported/rejected clipboard never displays false success", async () => {
  const value=table("| A | B |\n|---|---|\n| 1 | 2 |");
  assert.equal(await copyChatTable(undefined,value),false);
  assert.equal(await copyChatTable(async()=>{throw Error("Denied");},value),false);
});
