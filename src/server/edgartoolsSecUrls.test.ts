import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSecCik,
  normalizeSecAccession,
  safeSecArchiveFileName,
  buildSecSubmissionsUrl,
  buildSecCompanyFactsUrl,
  buildSecFilingArchiveUrl,
  buildSecFilingIndexUrl,
} from "./edgartoolsSecUrls";

test("EdgarTools URLs preserve canonical CIK padding without inventing a ticker", () => {
  assert.deepEqual(normalizeSecCik("0000320193"), { padded: "0000320193", numeric: "320193" });
  assert.deepEqual(normalizeSecCik(320193), { padded: "0000320193", numeric: "320193" });
  assert.equal(buildSecSubmissionsUrl("320193"), "https://data.sec.gov/submissions/CIK0000320193.json");
  assert.equal(buildSecCompanyFactsUrl("0000320193"), "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json");
  assert.equal(buildSecSubmissionsUrl("1234567890"), "https://data.sec.gov/submissions/CIK1234567890.json");
});

test("EdgarTools archive links retain exact immutable accession and company owner", () => {
  const accession = "0000320193-26-000011";
  assert.deepEqual(normalizeSecAccession(accession), { dashed: accession, digits: "000032019326000011" });
  assert.equal(buildSecFilingArchiveUrl("0000320193", accession, "index.json"),
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000011/index.json");
  assert.equal(buildSecFilingArchiveUrl(320193, accession, "form4.xml"),
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000011/form4.xml");
  assert.equal(buildSecFilingIndexUrl("0000320193", accession),
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000011/0000320193-26-000011-index.htm");
  assert.equal(safeSecArchiveFileName("xslF345X05/form4.xml"), false);
});

test("untrusted CIK, accession or provider directory filename cannot control the SEC archive path", () => {
  for (const cik of ["", "0000000000", "CIK0000320193", "../320193", "-1", "1/3", "1?x", "١٢٣", "12345678901", "3.14", -1, 0, Infinity, NaN]) {
    assert.throws(() => buildSecSubmissionsUrl(cik as string | number), /CIK/);
    assert.throws(() => buildSecCompanyFactsUrl(cik as string | number), /CIK/);
  }
  for (const accession of ["0000320193-26-000011/", "../0000320193-26-000011", "0000320193-26-00001", "0000320193-26-000011?x", "0000320193-26-000011%2f", "0000320193-26-000011-index.htm", "000032019326000011"]) {
    assert.throws(() => buildSecFilingIndexUrl("320193", accession), /accession/);
  }
  for (const file of ["../x.xml", "a/../../bad.xml", "a\\b.xml", "evil.xml?token=1", "evil.xml#hash", "x%2f.xml", "x..xml", ".hidden.xml", "", "☠.xml", "x".repeat(200)]) {
    assert.equal(safeSecArchiveFileName(file), false);
    assert.throws(() => buildSecFilingArchiveUrl("320193", "0000320193-26-000011", file), /filename/);
  }
  assert.equal(safeSecArchiveFileName("form4.xml"), true);
});

test("no arbitrary source hostname, mirror override, network request or provider runtime", () => {
  for (const url of [buildSecSubmissionsUrl(320193), buildSecCompanyFactsUrl(320193), buildSecFilingIndexUrl(320193, "0000320193-26-000011")]) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:");
    assert.ok(["www.sec.gov", "data.sec.gov"].includes(parsed.hostname));
    assert.equal(parsed.username, "");
    assert.equal(parsed.password, "");
    assert.equal(parsed.search, "");
    assert.equal(parsed.hash, "");
  }
});
