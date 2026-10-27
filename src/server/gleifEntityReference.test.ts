import assert from "node:assert/strict";
import test from "node:test";
import {
  GleifApiError, isValidLei, searchGleifLegalEntities,
} from "./gleifEntityReference";

const LEI = "5493001KJTIIGC8Y1R12"; // public ISO-format example, no customer data
const result = (id = LEI, extra = {}) => ({
  id,
  attributes: {
    lei: id,
    entity: {
      legalName: { name: "Synthetic Example Corporation" },
      legalAddress: { country: "US" },
      jurisdiction: "US-DE",
      status: "ACTIVE",
    },
    registration: { status: "ISSUED", lastUpdateDate: "2026-10-01T00:00:00Z" },
    ...extra,
  },
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), {
    status, headers: { "content-type": "application/vnd.api+json" },
  });
function mock(response: Response, onUrl?: (url: string) => void): typeof fetch {
  return (async (url: string | URL | Request) => { onUrl?.(String(url)); return response; }) as typeof fetch;
}

test("LEI ISO-17442 checksum validation rejects non-identifiers", () => {
  assert.equal(isValidLei(LEI), true);
  assert.equal(isValidLei("529900T8BM49AURSDO55"), true);
  assert.equal(isValidLei("5493001KJTIIGC8Y1R13"), false);
  assert.equal(isValidLei("ABCDEFGHIJ"), false);
});

test("verified LEI returns sourced legal entity but never a ticker or canonical P5 id", async () => {
  let seenUrl = "";
  const value = await searchGleifLegalEntities({ lei: LEI }, {
    fetcher: mock(json(result()), url => { seenUrl = url; }),
  });
  assert.equal(seenUrl, "https://api.gleif.org/api/v1/lei-records/" + LEI);
  assert.equal(value.status, "found");
  assert.equal(value.license, "CC0-1.0");
  assert.equal(value.records[0].legalAddressCountry, "US");
  assert.equal(value.records[0].registrationStatus, "ISSUED");
  assert.equal(value.records[0].canonical, false);
  assert.equal(value.records[0].tradability, "not_established");
  assert.equal("ticker" in value.records[0], false);
});

test("company name search returns candidates without promoting issuer identity", async () => {
  let seenUrl = "";
  const value = await searchGleifLegalEntities({ name: "Synthetic Example" }, {
    fetcher: mock(json([result()]), url => { seenUrl = url; }),
  });
  const request = new URL(seenUrl);
  assert.equal(request.hostname, "api.gleif.org");
  assert.equal(request.searchParams.get("filter[entity.legalName]"), "Synthetic Example");
  assert.equal(request.searchParams.get("page[size]"), "8");
  assert.equal(value.status, "candidates");
  assert.equal(value.records.length, 1);
});

test("malformed, truncated, mismatched and rate-limited responses fail closed", async () => {
  await assert.rejects(
    searchGleifLegalEntities({ lei: LEI.slice(0, 19) }, { fetcher: mock(json(result())) }),
    (e) => e instanceof GleifApiError && e.status === 400,
  );
  await assert.rejects(
    searchGleifLegalEntities({ name: "A" }, { fetcher: mock(json([result()])) }),
    (e) => e instanceof GleifApiError && e.status === 400,
  );
  assert.equal((await searchGleifLegalEntities({ lei: LEI }, {
    fetcher: mock(new Response(null, { status: 404 })),
  })).status, "not_found");
  await assert.rejects(
    searchGleifLegalEntities({ lei: LEI }, { fetcher: mock(new Response(null, { status: 429 })) }),
    (e) => e instanceof GleifApiError && e.status === 429,
  );
  await assert.rejects(
    searchGleifLegalEntities({ lei: LEI }, {
      fetcher: mock(json(result("529900T8BM49AURSDO55"))),
    }),
    (e) => e instanceof GleifApiError && e.status === 502,
  );
  await assert.rejects(
    searchGleifLegalEntities({ name: "Example Corporation" }, {
      fetcher: mock(json(Array.from({ length: 9 }, () => result()))),
    }),
    (e) => e instanceof GleifApiError && e.status === 502,
  );
  await assert.rejects(
    searchGleifLegalEntities({ lei: LEI }, {
      fetcher: mock(new Response(" ".repeat(512 * 1024 + 1), { status: 200 })),
    }),
    (e) => e instanceof GleifApiError && e.status === 502,
  );
});
