"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {
  parseNativeAcceptanceArgs,appArchivePath,fingerprintFile,
  isolatedSmokeEnv,runPackagedUnicodePdfAcceptance,
}=require("./si04_packaged_acceptance.cjs");

const fixturePdf=Buffer.from("%PDF-1.7\n"+"T".repeat(146)+"%%EOF\n");
const hash=data=>crypto.createHash("sha256").update(data).digest("hex");
function tempApp(t){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"lios-si04-native-acceptance-"));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const app=path.join(tmp,"LiOS-test-app");
  const resources=path.join(tmp,"resources");
  fs.mkdirSync(resources);
  fs.writeFileSync(app,"synthetic packaged executable\n");
  fs.writeFileSync(path.join(resources,"app.asar"),"synthetic ASAR\n");
  return {tmp,app};
}

test("Native acceptance requires explicit absolute paths and finds installed OS app archive",()=>{
  const app=path.resolve(os.tmpdir(),"LiOS"),out=path.resolve(os.tmpdir(),"report");
  assert.deepEqual(parseNativeAcceptanceArgs(["--app="+app,"--out="+out]),
    {appPath:app,outDir:out});
  assert.throws(()=>parseNativeAcceptanceArgs(["--app=./LiOS","--out="+out]),/absolute/);
  assert.throws(()=>parseNativeAcceptanceArgs(["--app="+app,"--out="+out,"--out="+out]),/exactly once/);
  assert.equal(appArchivePath("/Applications/LiOS.app/Contents/MacOS/LiOS","darwin"),
    "/Applications/LiOS.app/Contents/Resources/app.asar");
  assert.equal(appArchivePath("/opt/liosterminal/LiOS","linux"),
    "/opt/liosterminal/resources/app.asar");
});

test("Native acceptance never forwards provider API secrets to the installed smoke executable",()=>{
  const env=isolatedSmokeEnv({
    PATH:"/bin",HOME:"/tmp/isolated",OPENAI_API_KEY:"secret",
    ANTHROPIC_API_KEY:"private",GITHUB_TOKEN:"personal",
  },"/tmp/report.json","/tmp/native.pdf");
  assert.equal(env.PATH,"/bin");
  assert.equal(env.OPENAI_API_KEY,undefined);
  assert.equal(env.ANTHROPIC_API_KEY,undefined);
  assert.equal(env.GITHUB_TOKEN,undefined);
  assert.equal(env.LIOS_UNICODE_PDF_SMOKE_OUTPUT,"/tmp/native.pdf");
});

test("Native acceptance runs installed binary, verifies PDF receipt, tracks exact app.asar and preserves unmet visual gate",async t=>{
  const {tmp,app}=tempApp(t);
  const out=path.join(tmp,"acceptance-one");
  let dispatched=0;
  const result=await runPackagedUnicodePdfAcceptance({appPath:app,outDir:out},{
    spawn:(cmd,args,options)=>{
      dispatched++;
      assert.equal(cmd,app);
      assert.deepEqual(args,["--unicode-pdf-smoke"]);
      assert.equal(options.shell,false);
      assert.equal(options.env.ANTHROPIC_API_KEY,undefined);
      fs.writeFileSync(options.env.LIOS_UNICODE_PDF_SMOKE_OUTPUT,fixturePdf);
      const receipt={
        version:1,status:"native-pdf-rendered",source:"synthetic",pdfRetained:true,
        visualAcceptance:"not_tested",platform:process.platform,arch:process.arch,
        pdfSha256:hash(fixturePdf),pdfBytes:fixturePdf.length,
        contentCoverage:["Tamil","Devanagari","table","PNG","line chart"],
      };
      fs.writeFileSync(options.env.LIOS_UNICODE_PDF_SMOKE_REPORT,JSON.stringify(receipt));
      return {status:0,signal:null,error:null};
    },
    extract:async bytes=>{
      assert.deepEqual(bytes,fixturePdf);
      return {status:"text-extraction-verified",visualAcceptance:"not_tested",
        requiredFragments:["Tamil title","Hindi text","sources"],pages:2};
    },
  });
  assert.equal(dispatched,1);
  assert.equal(result.status,"native-smoke-verified");
  assert.equal(result.custody.pdfSha256,hash(fixturePdf));
  assert.equal(result.packagedExecutable.sha256,hash(Buffer.from("synthetic packaged executable\n")));
  assert.equal(result.packagedArchive.sha256,hash(Buffer.from("synthetic ASAR\n")));
  assert.equal(result.extraction.pages,2);
  assert.equal(result.visualAcceptance,"not_tested");
  assert.equal(result.productJourneyAcceptance,"not_tested");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,"native-acceptance.json"))).custody,result.custody);
  assert.throws(()=>fs.mkdirSync(out,{recursive:false}),/EEXIST/);
  await assert.rejects(
    runPackagedUnicodePdfAcceptance({appPath:app,outDir:out},{spawn:()=>{throw Error("must not execute");}}),
    /EEXIST/,
  );
});

test("Native packaged runner rejects missing archive and never presents a false success receipt",async t=>{
  const {tmp,app}=tempApp(t);
  fs.unlinkSync(path.join(tmp,"resources","app.asar"));
  await assert.rejects(runPackagedUnicodePdfAcceptance({
    appPath:app,outDir:path.join(tmp,"no-output"),
  }),/ENOENT/);
  assert.equal(fs.existsSync(path.join(tmp,"no-output")),false);
  assert.equal(fingerprintFile(app).sha256,hash(Buffer.from("synthetic packaged executable\n")));
});

test("Native acceptance rejects failed or missing PDF output while preserving exit failure",async t=>{
  const {tmp,app}=tempApp(t);
  await assert.rejects(runPackagedUnicodePdfAcceptance({
    appPath:app,outDir:path.join(tmp,"failed"),
  },{
    spawn:()=>({status:1,signal:null,error:null}),
    extract:async()=>{throw Error("should not reach extraction");},
  }),/smoke failed/);
  assert.equal(fs.existsSync(path.join(tmp,"failed","native-acceptance.json")),false);
});
