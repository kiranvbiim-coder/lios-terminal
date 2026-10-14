import test from "node:test";
import assert from "node:assert/strict";
import { discoverApiSource, fetchApiSource, mapApiRecordsToContract } from "./apiConnector";

test("REST connector fetches paginated JSON records with bearer credentials", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ input: String(input), init: init ?? {} });
    const page = new URL(String(input)).searchParams.get("page");
    return new Response(JSON.stringify(page === "1" ? [{ period: "FY2025", revenue: 10 }] : []), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await fetchApiSource({ endpoint: "https://data.example.test/financials", pageParam: "page", pageSizeParam: "limit", pageSize: 1 }, "secret");
    assert.equal(result.records.length, 1);
    assert.equal(result.pagesFetched, 2);
    assert.equal((requests[0].init.headers as Record<string, string>).Authorization, "Bearer secret");
    assert.equal(new URL(requests[0].input).searchParams.get("limit"), "1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("no-auth REST connector never emits an authorization header", async () => {
  const originalFetch = globalThis.fetch;
  let headers: Record<string, string> | undefined;
  globalThis.fetch = (async (_input, init) => {
    headers = init?.headers as Record<string, string>;
    return new Response(JSON.stringify([{ value: 1 }]), { status: 200 });
  }) as typeof fetch;
  try {
    await fetchApiSource({ endpoint: "https://public.example.test/data", authMode: "none" }, "should-not-be-used");
    assert.equal(headers?.Authorization, undefined);
    assert.equal(headers?.["X-API-Key"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REST discovery extracts a nested response path and profiles fields deterministically", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { results: [
    { symbol: "AAPL", price: 101, asOf: "2026-09-15" },
    { symbol: "MSFT", price: 102.5, asOf: "2026-09-15T08:30:00Z" },
  ] } }), { status: 200 })) as typeof fetch;
  try {
    const result = await discoverApiSource({ endpoint: "https://data.example.test/quotes", responsePath: "data.results", authMode: "none" }, null);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.observedRows, 2);
    assert.deepEqual(result.fields.map(field => field.name), ["symbol", "price", "asOf"]);
    assert.equal(result.fields.find(field => field.name === "price")?.type, "number");
    assert.equal(result.fields.find(field => field.name === "asOf")?.type, "datetime");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REST discovery rejects unsafe response paths before making a request", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => discoverApiSource({ endpoint: "https://data.example.test", responsePath: "data.__proto__.polluted" }, null), /Prototype-related/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REST connector rejects non-JSON responses and oversized declared bodies", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }),
    new Response("{}", { status: 200, headers: { "content-length": String(6 * 1024 * 1024) } }),
  ];
  globalThis.fetch = (async () => responses.shift()!) as typeof fetch;
  try {
    await assert.rejects(() => discoverApiSource({ endpoint: "https://data.example.test/text" }, null), /not valid JSON/);
    await assert.rejects(() => discoverApiSource({ endpoint: "https://data.example.test/large" }, null), /5 MB/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REST connector maps response records through canonical contracts", () => {
  const result = mapApiRecordsToContract([{ period: "FY2025", period_end_date: "2025-12-31", sales: 10 }], "financial_statements");
  assert.equal(result.records[0].period, "FY2025");
  assert.equal(result.records[0].periodEndDate, "2025-12-31");
  assert.equal(result.records[0].revenue, 10);
  assert.ok(result.missingFields.includes("operatingIncome"));
});

test("GraphQL and SOAP connectors normalize protocol payloads", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response(JSON.stringify({ data: { companies: [{ revenue: 12 }] } }), { status: 200 }),
    new Response("<Envelope><Body><companies><revenue>13</revenue></companies></Body></Envelope>", { status: 200 }),
  ];
  globalThis.fetch = (async () => responses.shift()!) as typeof fetch;
  try {
    const graphql = await fetchApiSource({ endpoint: "https://data.example.test/graphql", protocol: "graphql", graphqlQuery: "{ companies { revenue } }", responsePath: "data.companies" }, null);
    const soap = await fetchApiSource({ endpoint: "https://data.example.test/soap", protocol: "soap", soapBody: "<Envelope/>", responsePath: "Envelope.Body.companies" }, null);
    assert.equal(graphql.records[0].revenue, 12);
    assert.equal(soap.records[0].revenue, 13);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("hosted API connector rejects private destinations before fetch", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousOverride = process.env.LIOS_ALLOW_PRIVATE_CONNECTOR_NETWORKS;
  const originalFetch = globalThis.fetch;
  let called = false;
  try {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://db.example/lios";
    delete process.env.LIOS_ALLOW_PRIVATE_CONNECTOR_NETWORKS;
    globalThis.fetch = (async () => { called = true; throw new Error("must not fetch"); }) as typeof fetch;
    await assert.rejects(
      () => fetchApiSource({ endpoint: "https://127.0.0.1/private", authMode: "none" }, null),
      /local\/private network/i,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousOverride === undefined) delete process.env.LIOS_ALLOW_PRIVATE_CONNECTOR_NETWORKS; else process.env.LIOS_ALLOW_PRIVATE_CONNECTOR_NETWORKS = previousOverride;
  }
});

test("hosted API connector validates every redirect and refuses credential cross-origin forwarding", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const originalFetch = globalThis.fetch;
  try {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://db.example/lios";
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://8.8.8.8")) return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/metadata" } });
      throw new Error("unexpected fetch");
    }) as typeof fetch;
    await assert.rejects(
      () => fetchApiSource({ endpoint: "https://8.8.8.8/data", authMode: "none" }, null),
      /local\/private network/i,
    );

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://8.8.8.8")) return new Response(null, { status: 302, headers: { location: "https://1.1.1.1/data" } });
      throw new Error("unexpected fetch");
    }) as typeof fetch;
    await assert.rejects(
      () => fetchApiSource({ endpoint: "https://8.8.8.8/data" }, "top-secret"),
      /credentials across origins/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
