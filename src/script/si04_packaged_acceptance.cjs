"use strict";
/**
 * SI-04 packaged desktop acceptance runner.
 * This executes the actual installed Electron binary (never source Electron),
 * verifies its synthetic Chromium PDF and records SHA-256 of the executable
 * and app.asar. Source CI mocks this driver but never certifies native results.
 *
 * Usage:
 *   node script/si04_packaged_acceptance.cjs --app=/absolute/app/executable --out=/new/absolute/evidence-directory
 */
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {
  verifyUnicodePdfSmokeEvidence, verifyUnicodePdfSmokeText,
}=require("./verify_unicode_pdf_smoke.cjs");

const PDF_NAME="synthetic.pdf";
const RECEIPT_NAME="smoke-receipt.json";
const EVIDENCE_NAME="native-acceptance.json";
const MAX_APP_BYTES=8*1024*1024*1024;
const MAX_LOG_BYTES=1024*1024;
const TIMEOUT_MS=120_000;

function parseNativeAcceptanceArgs(args){
  const flags={};
  for(const arg of args){
    const match=/^--(app|out)=(.+)$/.exec(arg);
    if(!match || flags[match[1]])throw new Error("Specify --app and --out exactly once as absolute paths.");
    flags[match[1]]=match[2];
  }
  if(!flags.app || !flags.out || !path.isAbsolute(flags.app) || !path.isAbsolute(flags.out)){
    throw new Error("Native acceptance requires absolute --app and --out paths.");
  }
  return {appPath:path.normalize(flags.app),outDir:path.normalize(flags.out)};
}

function appArchivePath(appPath,platform=process.platform){
  if(platform==="darwin"){
    return path.posix.resolve(path.posix.dirname(appPath),"../Resources/app.asar");
  }
  if(platform==="win32"){
    return path.win32.join(path.win32.dirname(appPath),"resources","app.asar");
  }
  return path.posix.join(path.posix.dirname(appPath),"resources","app.asar");
}

function fingerprintFile(file){
  const stat=fs.lstatSync(file);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size<1 || stat.size>MAX_APP_BYTES){
    throw new Error("Native app identity requires a bounded regular executable/archive.");
  }
  const hash=crypto.createHash("sha256");
  const fd=fs.openSync(file,fs.constants.O_RDONLY);
  const buffer=Buffer.allocUnsafe(1024*1024);
  try {
    for(;;){
      const count=fs.readSync(fd,buffer,0,buffer.length,null);
      if(count===0)break;
      hash.update(buffer.subarray(0,count));
    }
  } finally { fs.closeSync(fd); }
  return {bytes:stat.size,sha256:hash.digest("hex")};
}

function isolatedSmokeEnv(env,receiptPath,pdfPath){
  // Prevent a native test from inheriting user/provider credentials.
  const allowed=["PATH","HOME","USERPROFILE","SYSTEMROOT","WINDIR","APPDATA",
    "LOCALAPPDATA","TMPDIR","TMP","TEMP","DISPLAY","WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR","XDG_CACHE_HOME","LANG","LC_ALL","LC_CTYPE",
    "LD_LIBRARY_PATH","DYLD_LIBRARY_PATH"];
  const sanitized={};
  for(const key of allowed)if(typeof env[key]==="string")sanitized[key]=env[key];
  return {
    ...sanitized,
    LIOS_UNICODE_PDF_SMOKE_REPORT:receiptPath,
    LIOS_UNICODE_PDF_SMOKE_OUTPUT:pdfPath,
  };
}

async function runPackagedUnicodePdfAcceptance(
  options,
  {spawn=spawnSync,extract=verifyUnicodePdfSmokeText}={},
){
  const {appPath,outDir}=options;
  if(!path.isAbsolute(appPath)||!path.isAbsolute(outDir)){
    throw new Error("Native acceptance paths must be absolute.");
  }
  const binary=fingerprintFile(appPath);
  const archive=fingerprintFile(appArchivePath(appPath));
  // The directory itself must be new, so neither current nor old evidence
  // can be overwritten or confused with this exact installed app.
  fs.mkdirSync(outDir,{recursive:false,mode:0o700});
  const receiptPath=path.join(outDir,RECEIPT_NAME);
  const pdfPath=path.join(outDir,PDF_NAME);
  const result=spawn(appPath,["--unicode-pdf-smoke"],{
    shell:false,
    env:isolatedSmokeEnv(process.env,receiptPath,pdfPath),
    encoding:"utf8",timeout:TIMEOUT_MS,maxBuffer:MAX_LOG_BYTES,
  });
  if(result.error || result.status!==0 || !fs.existsSync(receiptPath)
    || !fs.existsSync(pdfPath)){
    throw new Error("Packaged Unicode PDF smoke failed: "+
      (result.error?.message??("exit="+result.status+", signal="+(result.signal??"none"))));
  }
  const receipt=JSON.parse(fs.readFileSync(receiptPath,"utf8"));
  const bytes=fs.readFileSync(pdfPath);
  const custody=verifyUnicodePdfSmokeEvidence(receipt,bytes);
  const extraction=await extract(bytes);
  if(extraction.status!=="text-extraction-verified" || extraction.visualAcceptance!=="not_tested"
    || !Number.isSafeInteger(extraction.pages) || extraction.pages<1){
    throw new Error("Native Unicode PDF extraction was not independently verified.");
  }
  const report={
    schemaVersion:"1",status:"native-smoke-verified",kind:"si04-packaged-unicode-pdf",
    platform:process.platform,arch:process.arch,
    packagedExecutable:{file:path.basename(appPath),...binary},
    packagedArchive:{file:"app.asar",...archive},
    receiptFile:RECEIPT_NAME,pdfFile:PDF_NAME,
    custody:{status:custody.status,pdfSha256:custody.pdfSha256,pdfBytes:custody.pdfBytes},
    extraction:{status:extraction.status,pages:extraction.pages,
      requiredFragments:extraction.requiredFragments??[]},
    visualAcceptance:"not_tested",
    productJourneyAcceptance:"not_tested",
    limitations:[
      "No automatic Tamil/Hindi glyph-layout acceptance",
      "No signed/notarized installer or clean installation qualification",
      "No live user Research-to-Report-to-Office-return journey",
    ],
  };
  fs.writeFileSync(path.join(outDir,EVIDENCE_NAME),JSON.stringify(report,null,2)+"\n",{
    encoding:"utf8",flag:"wx",mode:0o600,
  });
  return report;
}

async function main(){
  const opts=parseNativeAcceptanceArgs(process.argv.slice(2));
  const result=await runPackagedUnicodePdfAcceptance(opts);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
if(require.main===module){
  main().catch(error=>{
    process.stderr.write("SI-04 packaged acceptance blocked: "+(error?.message??String(error))+"\n");
    process.exitCode=1;
  });
}

module.exports={parseNativeAcceptanceArgs,appArchivePath,fingerprintFile,
  isolatedSmokeEnv,runPackagedUnicodePdfAcceptance};
