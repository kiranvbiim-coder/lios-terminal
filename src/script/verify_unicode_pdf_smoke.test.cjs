"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {verifyUnicodePdfSmokeEvidence}=require("./verify_unicode_pdf_smoke.cjs");

const pdf=Buffer.from("%PDF-1.7\n"+"x".repeat(135)+"%%EOF\n");
const receipt={
  version:1,status:"native-pdf-rendered",source:"synthetic",
  platform:"darwin",arch:"arm64",pdfBytes:pdf.length,
  pdfSha256:crypto.createHash("sha256").update(pdf).digest("hex"),
  pdfRetained:true,visualAcceptance:"not_tested",
  contentCoverage:["Tamil","Devanagari","table","PNG","line chart"],
};

test("Installed synthetic Unicode PDF evidence requires exact byte hash and retains explicit visual limitation",()=>{
  const result=verifyUnicodePdfSmokeEvidence(receipt,pdf);
  assert.equal(result.status,"byte-custody-verified");
  assert.equal(result.pdfSha256,receipt.pdfSha256);
  assert.equal(result.visualAcceptance,"not_tested");
  assert.ok(result.limitations.some(x=>x.includes("Tamil/Hindi")));
});

test("Rejects truncated, forged or misleading native smoke receipts",()=>{
  assert.throws(()=>verifyUnicodePdfSmokeEvidence(receipt,Buffer.from("%PDF-")),/byte length or envelope/);
  assert.throws(()=>verifyUnicodePdfSmokeEvidence(receipt,Buffer.from(pdf.toString().replace("x","y"))),/SHA-256 mismatch/);
  assert.throws(()=>verifyUnicodePdfSmokeEvidence({...receipt,pdfBytes:pdf.length+1},pdf),/byte length or envelope/);
  assert.throws(()=>verifyUnicodePdfSmokeEvidence({...receipt,pdfSha256:"a".repeat(64)},pdf),/SHA-256 mismatch/);
  assert.throws(()=>verifyUnicodePdfSmokeEvidence({...receipt,source:"project:private"},pdf),/incomplete/);
  assert.throws(()=>verifyUnicodePdfSmokeEvidence({...receipt,pdfRetained:false},pdf),/incomplete/);
  assert.throws(()=>verifyUnicodePdfSmokeEvidence({...receipt,visualAcceptance:"passed"},pdf),/incomplete/);
  assert.throws(()=>verifyUnicodePdfSmokeEvidence({...receipt,contentCoverage:["Tamil"]},pdf),/incomplete/);
});
