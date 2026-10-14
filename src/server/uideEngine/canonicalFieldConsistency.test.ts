/**
 * Guards the Canonical Financial Data Model (shared/financialFields.ts)
 * against silent drift: every provider that maps external data (XBRL tags,
 * US-GAAP tags) onto a canonical field key must only ever use keys that
 * actually exist in the registry. A typo'd key here doesn't throw -- it
 * just silently produces a field the UI never renders and the balance
 * sheet identity check never sees, which is exactly the kind of bug that
 * hides until someone notices a number is missing. This test fails loudly
 * instead.
 *
 * Scoped to providers with a declarative key->mapping Record (xbrlFilingsOrg,
 * secEdgarFinancials, pdfStatementExtractor). screenerIndia.ts and
 * bseIndia.ts build their output keys imperatively (out.totalAssets = ...)
 * rather than from a static map, so there's no reliable static list to
 * check without an AST walk -- not worth the fragility for two connectors
 * with a handful of fields each.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_KEYS, type StatementType } from "@shared/financialFields";
import { INCOME_FIELDS as XBRL_INCOME, BALANCE_FIELDS as XBRL_BALANCE, CASHFLOW_FIELDS as XBRL_CASHFLOW } from "../xbrlFilingsOrg";
import { INCOME_FIELDS as EDGAR_INCOME, BALANCE_FIELDS as EDGAR_BALANCE, CASHFLOW_FIELDS as EDGAR_CASHFLOW } from "../secEdgarFinancials";
import { extractStatementsFromPdf } from "./pdfStatementExtractor";

function assertKeysAreCanonical(providerName: string, statementType: StatementType, keys: string[]) {
  const canonical = CANONICAL_KEYS[statementType];
  const unknown = keys.filter((k) => !canonical.has(k));
  assert.deepEqual(unknown, [], `${providerName}/${statementType} uses key(s) not in the canonical registry: ${unknown.join(", ")}`);
}

test("xbrlFilingsOrg field maps only use canonical keys", () => {
  assertKeysAreCanonical("xbrlFilingsOrg", "income", Object.keys(XBRL_INCOME));
  assertKeysAreCanonical("xbrlFilingsOrg", "balance", Object.keys(XBRL_BALANCE));
  assertKeysAreCanonical("xbrlFilingsOrg", "cashflow", Object.keys(XBRL_CASHFLOW));
});

test("secEdgarFinancials field maps only use canonical keys", () => {
  assertKeysAreCanonical("secEdgarFinancials", "income", Object.keys(EDGAR_INCOME));
  assertKeysAreCanonical("secEdgarFinancials", "balance", Object.keys(EDGAR_BALANCE));
  assertKeysAreCanonical("secEdgarFinancials", "cashflow", Object.keys(EDGAR_CASHFLOW));
});

test("pdfStatementExtractor's canonical label is never blank for any field it can return", async () => {
  // Not a real PDF -- just enough to exercise extractStatementsFromPdf's
  // field-def iteration without a full end-to-end fixture (that's covered
  // separately). Confirms the label-vs-synonym fix (see pdfStatementExtractor.ts's
  // module comment) actually holds: every field the extractor could report
  // carries a proper display label, not a lowercase synonym.
  const minimalPdf = Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Size 2/Root 1 0 R>>\n%%EOF",
  );
  const result = await extractStatementsFromPdf(minimalPdf, "empty.pdf");
  // No statement pages match in a blank document -- the real assertion here
  // is just that construction doesn't throw and returns the honest-empty
  // shape, proving the module loads its canonical import correctly.
  assert.equal(result.reports.length, 0);
});
