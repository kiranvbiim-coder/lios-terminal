import test from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { requireLocalByodIngestion } from "./clientRoutes";

test("hosted control plane rejects raw customer BYOD before upload parsing", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDb = process.env.DATABASE_URL;
  const previousHost = process.env.HOST;
  try {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://hosted.example/lios";
    process.env.HOST = "0.0.0.0";
    let status = 200;
    let body: unknown;
    let nextCalled = false;
    requireLocalByodIngestion(
      {} as Request,
      { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } } as unknown as Response,
      (() => { nextCalled = true; }) as NextFunction,
    );
    assert.equal(status, 403);
    assert.equal(nextCalled, false);
    assert.match(JSON.stringify(body), /local-desktop only/i);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb;
    if (previousHost === undefined) delete process.env.HOST; else process.env.HOST = previousHost;
  }
});

test("local desktop keeps BYOD ingestion enabled", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDb = process.env.DATABASE_URL;
  const previousHost = process.env.HOST;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    process.env.HOST = "127.0.0.1";
    let nextCalled = false;
    requireLocalByodIngestion(
      {} as Request,
      { status() { throw new Error("local runtime must not reject"); } } as unknown as Response,
      (() => { nextCalled = true; }) as NextFunction,
    );
    assert.equal(nextCalled, true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb;
    if (previousHost === undefined) delete process.env.HOST; else process.env.HOST = previousHost;
  }
});
