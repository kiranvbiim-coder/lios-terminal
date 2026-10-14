import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createBrowserProjectNetworkAuthority,
  executeBrowserConnector,
  type BrowserAutomationAdapter,
} from "./browserConnectorRuntime";

const policy = {
  projectId: 1,
  allowedDomains: ["sec.gov"],
  allowDownloads: false,
  downloadMaxBytes: 0,
  filesystemWriteRoots: [],
  navigationTimeoutMs: 30000,
  maxPages: 1,
};

test("P5 browser connector enforces domain and page policy", async () => {
  const visited: string[] = [];
  const adapter: BrowserAutomationAdapter = {
    id: "fixture",
    async navigate(url) { visited.push(url); return url; },
    async extract() { return { text: "ok" }; },
    async close() {},
  };
  const result = await executeBrowserConnector(policy, { urls: ["https://www.sec.gov/edgar"], extraction: { kind: "text" } }, adapter);
  assert.equal(visited.length, 1);
  assert.equal(result.outputs.length, 1);
  assert.deepEqual(result.pages, [{
    requestedUrl: "https://www.sec.gov/edgar",
    resolvedUrl: "https://www.sec.gov/edgar",
    output: { text: "ok" },
  }]);
  await assert.rejects(() => executeBrowserConnector(policy, { urls: ["https://example.com"], extraction: { kind: "text" } }, adapter), /outside Project policy/i);
});

test("SI-02 L12 Project network authority reuses BrowserConnectorPolicy for every brokered URL", () => {
  const authority = createBrowserProjectNetworkAuthority(policy);
  assert.equal(authority.projectId, 1);
  assert.equal(authority.authorize("https://www.sec.gov/Archives/edgar/data").hostname, "www.sec.gov");
  assert.throws(() => authority.authorize("https://example.com/"), /outside Project policy/i);
  assert.throws(() => authority.authorize("http://www.sec.gov/"), /HTTPS targets only/i);
  assert.throws(() => authority.authorize("https://user:secret@www.sec.gov/"), /must not embed credentials/i);
});

test("SI-02 L12 refuses an isolated adapter bound to a different Project before navigation", async () => {
  const visited: string[] = [];
  let closed = 0;
  const adapter: BrowserAutomationAdapter = {
    id: "isolated-project-2",
    networkProjectId: 2,
    async navigate(url) { visited.push(url); },
    async extract() { return "should-not-run"; },
    async close() { closed += 1; },
  };

  await assert.rejects(
    () => executeBrowserConnector(
      policy,
      { urls: ["https://www.sec.gov/edgar"], extraction: { kind: "text" } },
      adapter,
    ),
    /network authority does not match active Project policy/i,
  );
  assert.deepEqual(visited, []);
  assert.equal(closed, 1, "mismatched isolated adapters must still be closed");
});

test("SI-02 L12 closes the adapter when Project URL policy rejects before navigation", async () => {
  const visited: string[] = [];
  let closed = 0;
  const adapter: BrowserAutomationAdapter = {
    id: "policy-rejection-cleanup",
    networkProjectId: 1,
    async navigate(url) { visited.push(url); },
    async extract() { return "should-not-run"; },
    async close() { closed += 1; },
  };

  await assert.rejects(
    () => executeBrowserConnector(
      policy,
      { urls: ["https://example.com/"], extraction: { kind: "text" } },
      adapter,
    ),
    /outside Project policy/i,
  );
  assert.deepEqual(visited, []);
  assert.equal(closed, 1, "policy rejection must not leak an already-created browser adapter");
});


test("SI-03.07 browser connector preserves and re-authorizes resolved redirect identity", async () => {
  let extracted = 0;
  const adapter: BrowserAutomationAdapter = {
    id: "redirect-fixture",
    async navigate() { return "https://www.sec.gov/Archives/redirected"; },
    async extract() { extracted += 1; return { text: "resolved evidence" }; },
    async close() {},
  };
  const result = await executeBrowserConnector(policy, {
    urls: ["https://www.sec.gov/redirect"],
    extraction: { kind: "text" },
  }, adapter);
  assert.deepEqual(result.pages, [{
    requestedUrl: "https://www.sec.gov/redirect",
    resolvedUrl: "https://www.sec.gov/Archives/redirected",
    output: { text: "resolved evidence" },
  }]);
  assert.equal(extracted, 1);

  const escaped: BrowserAutomationAdapter = {
    id: "escaped-redirect",
    async navigate() { return "https://example.com/outside"; },
    async extract() { extracted += 1; return { text: "must not be accepted" }; },
    async close() {},
  };
  await assert.rejects(() => executeBrowserConnector(policy, {
    urls: ["https://www.sec.gov/redirect"],
    extraction: { kind: "text" },
  }, escaped), /outside Project policy/i);
  assert.equal(extracted, 1, "resolved URL is re-authorized before extraction");
});

test("browser-use download adaptation sends only safe basename and accepts exact Project root file",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-browser-sink-"));
 let received:string|null=null,closed=0;
 const adapter:BrowserAutomationAdapter={
  id:"approved-test",networkProjectId:1,
  async navigate(url){return url;},
  async extract(){return "observed";},
  async download(_url,filename){
   received=filename;
   const file=path.join(root,filename);
   fs.writeFileSync(file,"abcd");
   return {path:file,bytes:4};
  },
  async close(){closed++},
 };
 try{
  const result=await executeBrowserConnector({
   ...policy,allowDownloads:true,downloadMaxBytes:128,filesystemWriteRoots:[root],
  },{
   urls:["https://www.sec.gov/edgar"],extraction:{kind:"text"},
   download:{url:"https://www.sec.gov/report",filename:"..\\..\\secrets\\report.csv"},
  },adapter);
  assert.equal(received,"report.csv");
  assert.equal(result.download?.path,path.join(root,"report.csv"));
  assert.equal(closed,1);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test("download outside approved Project root is refused even for sibling-prefix path",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-browser-prefix-"));
 const sibling=root+"-evil";
 fs.mkdirSync(sibling);
 let closed=0;
 try{
  const adapter:BrowserAutomationAdapter={
   id:"untrusted-adapter",networkProjectId:1,
   async navigate(url){return url;},async extract(){return "ok";},
   async download(){return {path:path.join(sibling,"outside.pdf"),bytes:2};},
   async close(){closed++},
  };
  await assert.rejects(()=>executeBrowserConnector({
   ...policy,allowDownloads:true,downloadMaxBytes:128,filesystemWriteRoots:[root],
  },{
   urls:["https://www.sec.gov/edgar"],extraction:{kind:"text"},
   download:{url:"https://www.sec.gov/report",filename:"report.pdf"},
  },adapter),/escaped Project-approved/);
  assert.equal(closed,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(sibling,{recursive:true,force:true})}
});
