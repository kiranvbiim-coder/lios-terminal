"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {verifyUnicodePdfSmokeEvidence,assessUnicodePdfExtractedText,verifyUnicodePdfSmokeText}=require("./verify_unicode_pdf_smoke.cjs");

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


const documentedText=[
  "தமிழ் அறிக்கை · Native PDF smoke",
  "हिंदी परीक्षण · ₹450 · source:synthetic:test",
  "கிராமம் · கடலை",
  "Synthetic PNG · Source: source:synthetic:image",
  "சான்று · Synthetic plot · Source: source:synthetic:chart",
].join("\n");

test("Synthetic PDF extraction proves Tamil, Hindi, typed-table text and source labels",()=>{
  const result=assessUnicodePdfExtractedText(documentedText);
  assert.equal(result.status,"text-extraction-verified");
  assert.equal(result.visualAcceptance,"not_tested");
  assert.equal(result.requiredFragments.length,6);
  assert.ok(result.extractedCharacters>25);
});

test("Synthetic PDF extraction fails on damaged script text or missing evidence references",()=>{
  assert.throws(()=>assessUnicodePdfExtractedText(
    documentedText.replace("தமிழ் அறிக்கை","???? ???????")),/Tamil title/);
  assert.throws(()=>assessUnicodePdfExtractedText(
    documentedText.replace("हिंदी परीक्षण","xxxx")),/Hindi text/);
  assert.throws(()=>assessUnicodePdfExtractedText(
    documentedText.replace("கிராமம்","xxxx")),/table heading/);
  assert.throws(()=>assessUnicodePdfExtractedText(
    documentedText.replace("source:synthetic:chart","source:unlinked")),/chart source/);
  assert.throws(()=>assessUnicodePdfExtractedText(""),/missing or outside/);
});

test("PDF text gate actually runs parser, bounds page count and always releases its resources",async()=>{
  let destroyed=0;
  class ValidPDFParse {
    constructor({data}) { assert.ok(data instanceof Uint8Array); }
    async getText(){return {text:documentedText};}
    async getInfo(){return {total:2};}
    async destroy(){destroyed++;}
  }
  const result=await verifyUnicodePdfSmokeText(pdf,ValidPDFParse);
  assert.equal(result.status,"text-extraction-verified");
  assert.equal(result.pages,2);
  assert.equal(destroyed,1);
  class InvalidPDFParse extends ValidPDFParse {
    async getText(){return {text:"Tamil report but missing real script glyphs"};}
  }
  await assert.rejects(verifyUnicodePdfSmokeText(pdf,InvalidPDFParse),/missing: Tamil title/);
  assert.equal(destroyed,2);
  class InvalidPageCount extends ValidPDFParse {
    async getInfo(){return {total:0};}
  }
  await assert.rejects(verifyUnicodePdfSmokeText(pdf,InvalidPageCount),/page count is invalid/);
  assert.equal(destroyed,3);
});
