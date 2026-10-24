"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUnicodePdfPayload, buildUnicodeReportHtml, runNativeUnicodePdfSmoke } = require("./desktopUnicodePdf.cjs");

const payload = {
  artifactId: "artifact:owner-report", version: 3,
  contentHash: "a".repeat(64), filename: "Tamil-Report-v3.pdf",
  paragraphs: [
    { text: "தமிழ் ஆய்வு அறிக்கை", style: "title" },
    { text: "ஆய்வு முடிவுகள் – ₹450", style: "body" },
    { text: "Hindi: हिंदी परीक्षण", style: "quote" },
    { text: "source:permitted:8", style: "meta" },
  ],
};

test("Unicode printer retains original Tamil/Devanagari and canonical source text", () => {
  const input = normalizeUnicodePdfPayload(payload);
  assert.deepEqual(input.paragraphs, payload.paragraphs);
  const html = buildUnicodeReportHtml(input);
  assert.match(html, /தமிழ் ஆய்வு அறிக்கை/);
  assert.match(html, /ஆய்வு முடிவுகள் – ₹450/);
  assert.match(html, /हिंदी परीक्षण/);
  assert.match(html, /source:permitted:8/);
  assert.match(html, /Noto Sans Tamil/);
  assert.match(html, /Nirmala UI/);
  assert.match(html, /Tamil Sangam MN/);
  assert.match(html, /@page\{size:A4/);
  assert.match(html, /script-src &#39;none&#39;/);
  assert.doesNotMatch(html, /https:\/\/fonts\./);
});

test("Publisher escapes stored user content and never turns it into executable HTML", () => {
  const text = '<script src="https://evil.invalid/x"></script>&<img src=x onerror=alert(1)>';
  const html = buildUnicodeReportHtml({ ...payload, paragraphs: [
    { style: "quote", text },
    { style: "meta", text: "Evidence < private >" },
  ] });
  assert.doesNotMatch(html, /<script|<img\s/i);
  assert.match(html, /&lt;script src=&quot;https:\/\/evil\.invalid\/x&quot;&gt;/);
  assert.match(html, /Evidence &lt; private &gt;/);
});

test("Publishing boundary rejects oversized, forged and traversal payloads", () => {
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, contentHash: "forged" }), /exact saved/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, version: 0 }), /exact saved/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, filename: "../evil.pdf" }), /Unsafe/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, filename: "bad\r\n.pdf" }), /Unsafe/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs: [] }), /paragraph count/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs: [
    { style: "html", text: "<iframe />" },
  ] }), /Invalid Unicode PDF paragraph/);
  // Each paragraph has a 100k text guard before the aggregate 900k limit.
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs: [
    { style: "body", text: "x".repeat(100_001) },
  ] }), /Invalid Unicode PDF paragraph/);
  // A set of individually permitted paragraphs must still respect the
  // cumulative text budget; do not weaken either bound to satisfy a test.
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs:
    Array.from({ length: 10 }, () => ({ style: "body", text: "x".repeat(100_000) })),
  }), /local publishing text budget/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs:
    Array.from({ length: 4_001 }, () => ({ text: "x", style: "body" })),
  }), /paragraph count/);
});


test("Unicode PDF renders exact typed tables and escapes Tamil source text", () => {
  const input={ ...payload, items: [
    { kind:"paragraph",style:"title",text:"தமிழ் அட்டவணை" },
    { kind:"table", columns:["கிராமம்","வருமானம்"],
      rows:[["மதுரை","120"],["<img src=x onerror=attack()>","42"]] },
  ] };
  const html=buildUnicodeReportHtml(input);
  assert.match(html, /<table>/);
  assert.match(html, /கிராமம்/);
  assert.match(html, /<td>120<\/td>/);
  assert.match(html, /&lt;img src=x onerror=attack\(\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.throws(() => buildUnicodeReportHtml({ ...input,
    items: [{kind:"table",columns:["one","two"],rows:[["missing"]]}] }), /row shape mismatch/);
});

test("Native PDF preserves verified captured PNG bytes, dimensions and citation", () => {
  const crypto=require("node:crypto");
  const base64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5cAAAAASUVORK5CYII=";
  const bytes=Buffer.from(base64,"base64");
  const sha256=crypto.createHash("sha256").update(bytes).digest("hex");
  const image={ kind:"image",caption:"குளம்: களப் புகைப்படம்",sourceRef:"source:village:2026",
    mimeType:"image/png",dataBase64:base64,byteLength:bytes.length,width:1,height:1,sha256 };
  const html=buildUnicodeReportHtml({ ...payload,items:[{kind:"paragraph",style:"title",text:"Tamil report"},image]});
  assert.match(html, /<img width="1" height="1"/);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /Source: source:village:2026/);
  assert.match(html, new RegExp(sha256));
  assert.match(html,/img-src data:/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload,items:[{...image,sha256:"f".repeat(64)}] }),/checksum/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload,items:[{...image,width:4}] }),/dimensions/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload,items:[{...image,dataBase64:"https://bad.invalid/a"}] }),/Invalid bounded/);
});

test("SVG plots are source-backed, preserve gaps and negative numbers; never interpolate missing observations", () => {
  const plot={kind:"chart",caption:"மழை / Yield",sourceRef:"source:metric:1",
    chartType:"line",xKind:"category",yDomain:[-10,20],windows:[{
      xValues:["வாரம் 1","வாரம் 2","வாரம் 3"],
      series:[
        {label:"மழை",points:[{xIndex:0,y:10},{xIndex:2,y:-5}]},
        {label:"சாகுபடி",points:[{xIndex:1,y:0}]},
      ],
    }]};
  const html=buildUnicodeReportHtml({ ...payload,items:[{kind:"paragraph",style:"title",text:"Chart report"},plot]});
  assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(html,/மழை \/ Yield/);
  assert.match(html,/வாரம் 1/);
  assert.match(html,/>-10<\/text>/);
  assert.match(html,/>20<\/text>/);
  assert.match(html,/Source: source:metric:1/);
  assert.equal((html.match(/<circle /g)??[]).length,3);
  assert.equal((html.match(/<polyline /g)??[]).length,0, "No synthetic line across missing middle observation");
  assert.throws(() => buildUnicodeReportHtml({...payload,items:[
    {...plot,windows:[{xValues:[0,1],series:[{label:"bad",points:[{xIndex:2,y:8}]}]}]},
  ]}), /Invalid or duplicate/);
});


test("Structured Unicode print payload counts the flattened and native views independently", () => {
  const texts=Array.from({length: 5},(_,i)=>"தமிழ் "+String(i)+" "+"x".repeat(99_980));
  const paragraphs=texts.map(text=>({style:"body",text}));
  const items=paragraphs.map(item=>({kind:"paragraph",...item}));
  const parsed=normalizeUnicodePdfPayload({...payload,paragraphs,items});
  assert.equal(parsed.paragraphs.length,5);
  assert.equal(parsed.items.length,5);
  assert.equal(parsed.items.map(x=>x.text).join(""),texts.join(""));
  const inflated=Array.from({length:10},()=>({kind:"paragraph",style:"body",text:"x".repeat(100_000)}));
  assert.throws(()=>normalizeUnicodePdfPayload({...payload,paragraphs,items:inflated}),/text budget/);
  assert.throws(()=>normalizeUnicodePdfPayload({...payload,paragraphs:inflated,items}),/text budget/);
});


test("Packaged LiOS Electron app includes the local native Unicode printer", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const files = manifest.build?.files;
  assert.ok(Array.isArray(files), "electron-builder must declare a package contents allowlist");
  assert.ok(files.includes("desktopUnicodePdf.cjs"),
    "Native Unicode PDF exports need desktopUnicodePdf.cjs inside the installed app.asar");
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /require\("\.\/desktopUnicodePdf\.cjs"\)/,
    "Main process must resolve the same packaged module");
});


test("Packaged Chromium smoke probes synthetic Tamil, table, chart and PNG without using a workspace", async () => {
  let windowDestroyed = false;
  let printedUrl = "";
  let intercepted = null;
  let popupAction = "";
  const signature = Buffer.from("%PDF-1.7\n" + "x".repeat(140) + "%%EOF\n");
  const options = {BrowserWindow: class {
    constructor(settings) {
      assert.equal(settings.show,false);
      assert.equal(settings.webPreferences.sandbox,true);
      assert.equal(settings.webPreferences.javascript,false);
      assert.equal(settings.webPreferences.nodeIntegration,false);
      assert.equal(settings.webPreferences.contextIsolation,true);
      assert.equal(settings.webPreferences.webSecurity,true);
      assert.match(settings.webPreferences.partition,/^lios-unicode-pdf-smoke-/);
      this.webContents={
        setWindowOpenHandler:(callback)=>{popupAction=callback().action;},
        on:(name,callback)=>{if(name==="will-navigate"){const event={preventDefault(){}};callback(event);}},
        printToPDF:async settings=>{
          assert.equal(settings.pageSize,"A4");
          return signature;
        },
      };
    }
    async loadURL(value){ printedUrl=decodeURIComponent(value); }
    isDestroyed(){return windowDestroyed;}
    destroy(){windowDestroyed=true;}
  },session:{fromPartition:(partition,options)=>{
    assert.match(partition,/^lios-unicode-pdf-smoke-/);
    assert.equal(options.cache,false);
    return {webRequest:{onBeforeRequest: callback=>{intercepted=callback;}}};
  }}};
  const result=await runNativeUnicodePdfSmoke(options);
  assert.equal(result.status,"native-pdf-rendered");
  assert.equal(result.visualAcceptance,"not_tested");
  assert.equal(result.pdfBytes,signature.length);
  assert.equal(result.pdfSha256,require("node:crypto").createHash("sha256").update(signature).digest("hex"));
  assert.equal(result.pdfRetained,false);
  assert.equal(result.source,"synthetic");
  assert.deepEqual(result.contentCoverage,["Tamil","Devanagari","table","PNG","line chart"]);
  assert.match(printedUrl,/தமிழ் அறிக்கை/);
  assert.match(printedUrl,/हिंदी परीक्षण/);
  assert.match(printedUrl,/<table>/);
  assert.match(printedUrl,/<svg /);
  assert.match(printedUrl,/data:image\/png;base64,/);
  assert.equal(popupAction,"deny");
  assert.equal(windowDestroyed,true);
  assert.ok(intercepted);
  intercepted({url:"https://malicious.invalid/"}, result=>assert.deepEqual(result,{cancel:true}));
  intercepted({url:"data:image/png;base64,YQ=="}, result=>assert.deepEqual(result,{cancel:false}));
});

test("Native Unicode PDF smoke fails closed on an invalid Chromium result and destroys its window", async () => {
  let destroyed=false;
  const options={BrowserWindow:class {
    webContents={
      setWindowOpenHandler() {},
      on() {},
      printToPDF:async()=>Buffer.from("not a PDF"),
    };
    async loadURL() {}
    isDestroyed(){return destroyed;}
    destroy(){destroyed=true;}
  },session:{fromPartition:()=>({webRequest:{onBeforeRequest(){}}})}};
  await assert.rejects(runNativeUnicodePdfSmoke(options),/valid bounded PDF/);
  assert.equal(destroyed,true);
});


test("Opt-in native smoke returns checksum evidence for the exact emitted synthetic PDF", async () => {
  const crypto = require("node:crypto");
  const bytes = Buffer.from("%PDF-1.7\n" + "synthetic".repeat(20) + "%%EOF\n");
  let returned = null;
  let destroyed = false;
  const options = {
    BrowserWindow: class {
      webContents = {
        setWindowOpenHandler() {},
        on() {},
        printToPDF: async () => bytes,
      };
      async loadURL() {}
      isDestroyed() { return destroyed; }
      destroy() { destroyed = true; }
    },
    session: { fromPartition: () => ({webRequest:{onBeforeRequest(){}}}) },
    onPdf: async pdf => { returned = Buffer.from(pdf); },
  };
  const result = await runNativeUnicodePdfSmoke(options);
  assert.deepEqual(returned,bytes);
  assert.equal(result.pdfRetained,true);
  assert.equal(result.pdfBytes,bytes.length);
  assert.equal(result.pdfSha256,crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.visualAcceptance,"not_tested");
  assert.equal(destroyed,true);
  await assert.rejects(
    runNativeUnicodePdfSmoke({...options,onPdf:"not a callback"}),
    /explicit local callback/,
  );
});

test("Opt-in evidence write failure fails native smoke and releases the print window", async () => {
  let destroyed = false;
  const options = {
    BrowserWindow: class {
      webContents = {
        setWindowOpenHandler() {},
        on() {},
        printToPDF: async () => Buffer.from("%PDF-1.7\n" + "x".repeat(150) + "%%EOF\n"),
      };
      async loadURL() {}
      isDestroyed() { return destroyed; }
      destroy() { destroyed = true; }
    },
    session: { fromPartition: () => ({webRequest:{onBeforeRequest(){}}}) },
    onPdf: async () => { throw new Error("Evidence destination already exists"); },
  };
  await assert.rejects(runNativeUnicodePdfSmoke(options),/already exists/);
  assert.equal(destroyed,true);
});
