import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import { createP13PluginFileAuxiliaryHandler } from "./p13PluginFileBroker";

const context:RuntimeExecutionContext = {
  requestId:"11111111-1111-4111-8111-111111111111",
  userId:1,organizationId:1,projectId:1,sessionId:null,
  conversationId:null,activeObjectId:null,dataClassification:"private",approvedActions:[],
};
const executionRequestId="22222222-2222-4222-8222-222222222222";
const componentId="plugin.files.echo";
const manifest=(permissions:string[])=>liosPluginManifestV1Schema.parse({
  apiVersion:"1",id:"com.example.file",name:"Test",version:"1.0.0",
  publisher:"Example",lios:{sdkVersion:"1",minVersion:"1.0.0",maxVersion:null},
  runtime:{kind:"node_process",entrypoint:"plugin.mjs"},
  dependencies:[],permissions,connectors:[],tools:[
    {id:"echo",componentId,name:"Echo",capabilities:["plugin.file"]},
  ],artifacts:[],agents:[],integrity:null,signer:null,
});
const base={
  protocol:"lios-plugin-broker/1",kind:"filesystem.read",
  requestId:"33333333-3333-4333-8333-333333333333",
  executionRequestId,componentId,scope:"project",rootIndex:0,
  relativePath:"input.txt",maxBytes:128,
}as const;

test("file auxiliary returns approved bytes and digest without host paths; rejects symlinks/traversal/scope drift",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-p13-file-"));
  const other=fs.mkdtempSync(path.join(os.tmpdir(),"lios-p13-other-"));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(other,{recursive:true,force:true});});
  fs.writeFileSync(path.join(root,"input.txt"),"known input");
  fs.mkdirSync(path.join(root,"nested"));
  fs.writeFileSync(path.join(root,"nested","input.txt"),"approved nested input");
  fs.writeFileSync(path.join(other,"secret.txt"),"private");
  fs.symlinkSync(path.join(other,"secret.txt"),path.join(root,"escape.txt"));
  fs.symlinkSync(path.join(other,"not-created"),path.join(root,"dangling.txt"));
  const binding={componentId,context};
  const grant={projectRoot:root,userSelectedReadRoots:[other],userSelectedWriteRoots:[],
    networkHosts:[],allowProcessSpawn:false};
  let active=true;
  const handler=createP13PluginFileAuxiliaryHandler({
    manifest:manifest(["filesystem.project.read","filesystem.user_selected.read"]),
    grant,lookupExecution:id=>id===executionRequestId&&active?binding:null,
    authorizeFileRead: ({ context: current, root: selectedRoot, scope, rootIndex }) =>
      current.userId === 1 && current.organizationId === 1 && current.projectId === 1
      && rootIndex === 0 && (scope === "project" ? selectedRoot === root : selectedRoot === other),
  });
  const ok=await handler(base) as {kind:string;size:number;sha256:string;bodyBase64:string};
  assert.equal(ok.kind,"filesystem.response");
  assert.equal(ok.size,11);
  assert.equal(Buffer.from(ok.bodyBase64,"base64").toString(),"known input");
  assert.match(ok.sha256,/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(ok).includes(root),false);
  // Existing permitted nested file proves the alias cases below would expose
  // actual content if they were normalized away before authorization.
  const nestedRead=await handler({...base,relativePath:"nested/input.txt"}) as {kind:string;bodyBase64:string};
  assert.equal(nestedRead.kind,"filesystem.response");
  assert.equal(Buffer.from(nestedRead.bodyBase64,"base64").toString(),"approved nested input");

  const selected=await handler({...base,scope:"user_selected",relativePath:"secret.txt"}) as {kind:string;bodyBase64:string};
  assert.equal(selected.kind,"filesystem.response");
  assert.equal(Buffer.from(selected.bodyBase64,"base64").toString(),"private");
  for(const p of [
    "../escape","/etc/passwd","escape.txt","dangling.txt",".","missing.txt",
    "./input.txt","nested/../input.txt","nested/./input.txt","nested//input.txt",
    "nested/.","nested/..","nested/input.txt/",
  ]){
    const err=await handler({...base,relativePath:p}) as {kind:string;code:string};
    assert.equal(err.kind,"filesystem.error",p);
    assert.equal(err.code,"filesystem_read_denied");
    assert.equal(JSON.stringify(err).includes(root),false);
  }
  const big=await handler({...base,maxBytes:4}) as {code:string};
  assert.equal(big.code,"filesystem_read_denied");
  const wrong=await handler({...base,componentId:"plugin.fake"}) as {code:string};
  assert.equal(wrong.code,"filesystem_execution_scope_invalid");
  const wrongRoot=await handler({...base,rootIndex:1}) as {code:string};
  assert.equal(wrongRoot.code,"filesystem_root_not_granted");
  active=false;
  const revoked=await handler(base) as {code:string};
  assert.equal(revoked.code,"filesystem_execution_scope_invalid");
});

test("read-only broker denies absent, revoked, or wrong tenant/Project read grants",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-p13-scoped-read-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,"input.txt"),"restricted");
  const binding={componentId,context};
  const grant={projectRoot:root,userSelectedReadRoots:[],userSelectedWriteRoots:[],networkHosts:[],allowProcessSpawn:false};
  const manifestInput=manifest(["filesystem.project.read"]);
  const absent=createP13PluginFileAuxiliaryHandler({manifest:manifestInput,grant,lookupExecution:()=>binding});
  assert.equal((await absent(base) as {code:string}).code,"filesystem_execution_scope_invalid");
  let currentProject=1;
  let checks=0;
  const handler=createP13PluginFileAuxiliaryHandler({
    manifest:manifestInput,grant,lookupExecution:()=>binding,
    authorizeFileRead: ({ context: current, root: candidate, scope }) => {
      checks++;
      return current.userId===1 && current.organizationId===1
        && current.projectId===currentProject && candidate===root && scope==="project";
    },
  });
  assert.equal((await handler(base) as {kind:string}).kind,"filesystem.response");
  assert.equal(checks,2);
  currentProject=2;
  assert.equal((await handler(base) as {code:string}).code,"filesystem_execution_scope_invalid");
  currentProject=1;
  checks=0;
  const revokedDuringRead=createP13PluginFileAuxiliaryHandler({
    manifest:manifestInput,grant,lookupExecution:()=>binding,
    authorizeFileRead: (args)=> {
      const allowed=checks++===0;
      return allowed && args.context.projectId===1 && args.root===root;
    },
  });
  const revoked=await revokedDuringRead(base) as {kind:string;code:string;bodyBase64?:string};
  assert.equal(revoked.code,"filesystem_execution_revoked");
  assert.equal(revoked.bodyBase64,undefined);
  assert.equal(JSON.stringify(revoked).includes(root),false);
});

test("read-only auxiliary cannot become a privileged write or bypass manifest permission",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-p13-denied-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,"input.txt"),"safe");
  const handler=createP13PluginFileAuxiliaryHandler({
    manifest:manifest(["network.http"]),
    grant:{projectRoot:root,userSelectedReadRoots:[],userSelectedWriteRoots:[],networkHosts:[],allowProcessSpawn:false},
    lookupExecution:id=>id===executionRequestId?{componentId,context}:null,
  });
  const result=await handler(base) as {code:string};
  assert.equal(result.code,"filesystem_permission_denied");
  assert.equal(await handler({...base,kind:"filesystem.write",bodyBase64:"AQ=="}),null);
});

test("P13 read denies invalid principal triples before exposing Project bytes",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-p13-principal-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,"input.txt"),"restricted");
  const grant={projectRoot:root,userSelectedReadRoots:[],userSelectedWriteRoots:[],
    networkHosts:[],allowProcessSpawn:false};
  for(const field of ["userId","organizationId","projectId"] as const){
    for(const value of [undefined,null,0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,"1"]){
      const invalid={...context,[field]:value} as RuntimeExecutionContext;
      const handler=createP13PluginFileAuxiliaryHandler({
        manifest:manifest(["filesystem.project.read"]),grant,
        lookupExecution:()=>({componentId,context:invalid}),
      });
      const reply=await handler(base) as {kind:string;code:string;bodyBase64?:string};
      assert.equal(reply.kind,"filesystem.error",`${field}=${String(value)}`);
      assert.equal(reply.code,"filesystem_execution_scope_invalid",`${field}=${String(value)}`);
      assert.equal(reply.bodyBase64,undefined);
      assert.equal(JSON.stringify(reply).includes(root),false);
    }
  }
});

test("P13 read discards bytes if execution binding changes during the host read",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-p13-rebind-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,"input.txt"),"must-not-return");
  const first={componentId,context};
  const replaced={componentId,context:{...context,organizationId:2}};
  let lookups=0;
  const handler=createP13PluginFileAuxiliaryHandler({
    manifest:manifest(["filesystem.project.read"]),
    grant:{projectRoot:root,userSelectedReadRoots:[],userSelectedWriteRoots:[],
      networkHosts:[],allowProcessSpawn:false},
    lookupExecution:()=>++lookups===1?first:replaced,
    authorizeFileRead: () => true,
  });
  const reply=await handler(base) as {kind:string;code:string;bodyBase64?:string};
  assert.equal(reply.kind,"filesystem.error");
  assert.equal(reply.code,"filesystem_execution_revoked");
  assert.equal(reply.bodyBase64,undefined);
  assert.equal(JSON.stringify(reply).includes(root),false);
  assert.equal(lookups,2);
});
