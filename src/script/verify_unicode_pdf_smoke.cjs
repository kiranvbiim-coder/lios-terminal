"use strict";

/**
 * Offline evidence validator for the opt-in packaged Chromium Unicode PDF
 * smoke. Tests byte custody, not Tamil glyph appearance or source licensing.
 * Usage: node script/verify_unicode_pdf_smoke.cjs receipt.json synthetic.pdf
 */
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

const REQUIRED_COVERAGE=["Tamil","Devanagari","table","PNG","line chart"];
const MAX_PDF_BYTES=32*1024*1024;

function verifyUnicodePdfSmokeEvidence(receipt,bytes){
  if (!receipt || typeof receipt!=="object"
    || receipt.version!==1 || receipt.status!=="native-pdf-rendered"
    || receipt.source!=="synthetic" || receipt.pdfRetained!==true
    || receipt.visualAcceptance!=="not_tested"
    || !["darwin","win32","linux"].includes(receipt.platform)
    || !["arm64","x64","ia32"].includes(receipt.arch)
    || !Array.isArray(receipt.contentCoverage)
    || receipt.contentCoverage.length!==REQUIRED_COVERAGE.length
    || REQUIRED_COVERAGE.some((item,i)=>receipt.contentCoverage[i]!==item)){
    throw new Error("Native Unicode PDF evidence receipt is incomplete or not a packaged synthetic smoke.");
  }
  if (!Buffer.isBuffer(bytes) || bytes.length<100 || bytes.length>MAX_PDF_BYTES
    || !Number.isSafeInteger(receipt.pdfBytes) || bytes.length!==receipt.pdfBytes
    || bytes.subarray(0,5).toString("ascii")!=="%PDF-"
    || !/%%EOF\s*$/.test(bytes.subarray(Math.max(0,bytes.length-32)).toString("ascii"))){
    throw new Error("Native Unicode PDF evidence byte length or envelope does not match.");
  }
  const digest=crypto.createHash("sha256").update(bytes).digest("hex");
  if (typeof receipt.pdfSha256!=="string" || !/^[a-f0-9]{64}$/.test(receipt.pdfSha256)
    || receipt.pdfSha256!==digest){
    throw new Error("Native Unicode PDF evidence SHA-256 mismatch.");
  }
  return {
    status:"byte-custody-verified",
    pdfBytes:bytes.length,
    pdfSha256:digest,
    platform:receipt.platform,
    arch:receipt.arch,
    nativePdfReported:true,
    visualAcceptance:"not_tested",
    limitations:["Tamil/Hindi glyph appearance not verified","PDF text extraction not verified",
      "End-to-end saved Artifact import/edit/export not verified"],
  };
}


const EXTRACTED_TEXT_REQUIRED = Object.freeze([
  {label:"Tamil title",text:"தமிழ் அறிக்கை"},
  {label:"Hindi text",text:"हिंदी परीक्षण"},
  {label:"Tamil table heading",text:"கிராமம்"},
  {label:"synthetic text source",text:"source:synthetic:test"},
  {label:"captured image source",text:"source:synthetic:image"},
  {label:"governed chart source",text:"source:synthetic:chart"},
]);

function assessUnicodePdfExtractedText(text) {
  if (typeof text!=="string" || text.length===0 || text.length>2_000_000) {
    throw new Error("Native Unicode PDF extracted text is missing or outside bounded limits.");
  }
  const normalized=text.normalize("NFC").replace(/\s+/gu," ");
  const missing=EXTRACTED_TEXT_REQUIRED.filter(item=>
    !normalized.includes(item.text.normalize("NFC"))).map(item=>item.label);
  if(missing.length) {
    throw new Error("Native Unicode PDF text extraction missing: "+missing.join(", ")+".");
  }
  return {
    status:"text-extraction-verified",
    requiredFragments:EXTRACTED_TEXT_REQUIRED.map(item=>item.label),
    extractedCharacters:normalized.length,
    visualAcceptance:"not_tested",
  };
}

async function verifyUnicodePdfSmokeText(bytes, ParserClass) {
  if (!Buffer.isBuffer(bytes) || bytes.length<100 || bytes.length>MAX_PDF_BYTES) {
    throw new Error("Native Unicode PDF text inspection requires bounded original bytes.");
  }
  // Deliberately import only for actual text inspection: basic byte custody
  // must remain usable offline even before optional PDF parser setup.
  const PDFParse = ParserClass ?? require("pdf-parse").PDFParse;
  if (typeof PDFParse!=="function") throw new Error("Native Unicode PDF parser is unavailable.");
  const reader=new PDFParse({data:new Uint8Array(bytes)});
  try {
    const extraction=await reader.getText();
    const inspection=assessUnicodePdfExtractedText(extraction?.text);
    const info=await reader.getInfo();
    if(!Number.isSafeInteger(info?.total) || info.total<1 || info.total>1_000) {
      throw new Error("Native Unicode PDF extracted page count is invalid.");
    }
    return {...inspection,pages:info.total};
  } finally {
    await reader.destroy();
  }
}

async function runCli(){
  const [jsonPath,pdfPath]=process.argv.slice(2);
  if (!jsonPath||!pdfPath) {
    process.stderr.write("Usage: node script/verify_unicode_pdf_smoke.cjs <receipt.json> <synthetic.pdf>\n");
    process.exitCode=2;
    return;
  }
  try {
    const receipt=JSON.parse(fs.readFileSync(path.resolve(jsonPath),"utf8"));
    const pdf=fs.readFileSync(path.resolve(pdfPath));
    const custody=verifyUnicodePdfSmokeEvidence(receipt,pdf);
    const text=await verifyUnicodePdfSmokeText(pdf);
    process.stdout.write(JSON.stringify({...custody,sourceText:text},null,2)+"\n");
  } catch(error) {
    process.stderr.write("Native Unicode PDF evidence rejected: "+(error?.message??String(error))+"\n");
    process.exitCode=1;
  }
}

if (require.main===module) {
  runCli().catch(error=>{
    process.stderr.write("Native Unicode PDF verification error: "+(error?.message??String(error))+"\n");
    process.exitCode=1;
  });
}

module.exports={verifyUnicodePdfSmokeEvidence,assessUnicodePdfExtractedText,verifyUnicodePdfSmokeText};
