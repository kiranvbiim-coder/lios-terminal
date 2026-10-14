import assert from "node:assert/strict";
import test from "node:test";
import multer from "multer";
import { extensionOf, safeUploadFileName, uploadErrorResponse, validateUploadFileSignature } from "./uploadPolicy";

test("extensionOf normalizes the final file extension", () => {
  assert.equal(extensionOf("Quarterly.Report.XLSX"), "xlsx");
  assert.equal(extensionOf("README"), "");
});

test("upload errors have stable client-facing status codes", () => {
  assert.deepEqual(uploadErrorResponse(new multer.MulterError("LIMIT_FILE_SIZE")), {
    status: 413,
    message: "Uploaded file exceeds the allowed size.",
  });
  assert.deepEqual(uploadErrorResponse(new multer.MulterError("LIMIT_FIELD_COUNT")), {
    status: 400,
    message: "Too many form fields were included with the upload.",
  });
  assert.deepEqual(uploadErrorResponse(new multer.MulterError("LIMIT_PART_COUNT")), {
    status: 400,
    message: "The upload contains too many multipart sections.",
  });
  assert.equal(uploadErrorResponse(new Error("parser failed")), null);
});


test("upload content signatures reject extension spoofing and binary text", () => {
  assert.equal(validateUploadFileSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64]), "xlsx"), null);
  assert.equal(validateUploadFileSignature(Buffer.from("PK\u0003\u0004payload", "binary"), "docx"), null);
  assert.equal(validateUploadFileSignature(Buffer.from("PK\u0003\u0004payload", "binary"), "pptx"), null);
  assert.match(validateUploadFileSignature(Buffer.from("not a workbook"), "xlsx") ?? "", /ZIP container/i);
  assert.equal(validateUploadFileSignature(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]), "xls"), null);
  assert.match(validateUploadFileSignature(Buffer.from("a\u0000b"), "csv") ?? "", /binary\/NUL/i);
});

test("uploaded filenames cannot inject paths or control characters", () => {
  assert.equal(safeUploadFileName("../folder\\quarterly\nreport.xlsx"), "quarterly_report.xlsx");
  assert.ok(safeUploadFileName("a".repeat(250) + ".csv").length <= 180);
});
