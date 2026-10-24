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

if (require.main===module) {
  const [jsonPath,pdfPath]=process.argv.slice(2);
  if (!jsonPath||!pdfPath) {
    process.stderr.write("Usage: node script/verify_unicode_pdf_smoke.cjs <receipt.json> <synthetic.pdf>\n");
    process.exitCode=2;
  } else {
    try {
      const receipt=JSON.parse(fs.readFileSync(path.resolve(jsonPath),"utf8"));
      const pdf=fs.readFileSync(path.resolve(pdfPath));
      const result=verifyUnicodePdfSmokeEvidence(receipt,pdf);
      process.stdout.write(JSON.stringify(result,null,2)+"\n");
    } catch(error) {
      process.stderr.write("Native Unicode PDF evidence rejected: "+(error?.message??String(error))+"\n");
      process.exitCode=1;
    }
  }
}

module.exports={verifyUnicodePdfSmokeEvidence};
