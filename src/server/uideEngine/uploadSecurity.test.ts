import assert from "node:assert/strict";
import { test } from "node:test";
import { validateUideUpload } from "../uideRoutes";

function admit(file: { originalname: string; buffer: Buffer } | undefined, extensions?: readonly string[]) {
  let status = 200;
  const req = { file };
  const response = { status(code: number) { status = code; return { json(_payload: { error: string }) {} }; } };
  const accepted = validateUideUpload(req, response, extensions);
  return { accepted, status, name: req.file?.originalname };
}

test("original statement extraction admits real PDF bytes without broadening spreadsheet ingest", () => {
  const file = { originalname: "report.pdf", buffer: Buffer.from("%PDF-1.7\n") };
  assert.deepEqual(admit({ ...file }, ["pdf"]), { accepted: true, status: 200, name: "report.pdf" });
  assert.equal(admit({ ...file }).status, 400, "Spreadsheet profiling does not accept a PDF as a workbook.");
  assert.equal(admit({ originalname: "renamed.pdf", buffer: Buffer.from("not a PDF") }, ["pdf"]).status, 400);
  assert.equal(admit({ originalname: "book.xlsx", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }, ["pdf"]).status, 400);
});

test("original workbook upload validates actual file signatures and safe names", () => {
  assert.equal(admit(undefined).status, 400);
  assert.equal(admit({ originalname: "book.xlsx", buffer: Buffer.from("plain text") }).status, 400);
  assert.equal(admit({ originalname: "book.xlsx", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }).accepted, true);
  assert.equal(admit({ originalname: "data.csv", buffer: Buffer.from([0x41, 0x2c, 0x42, 0x00]) }).status, 400);
  assert.deepEqual(admit({ originalname: "../../client\\draft.csv", buffer: Buffer.from("period,value\n2025,100\n") }), { accepted: true, status: 200, name: "draft.csv" });
});
