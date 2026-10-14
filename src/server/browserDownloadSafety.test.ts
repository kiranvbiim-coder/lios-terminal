import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeBrowserDownloadFilename, assertBrowserDownloadInsideRoots } from "./browserDownloadSafety";

test("browser-use donor filename cases do not provide arbitrary write paths",()=>{
 const fixtures:[string,string][]=[
  ["../../etc/passwd","passwd"],["/etc/shadow","shadow"],
  ["..\\..\\Windows\\System32\\config.txt","config.txt"],
  ["a/b\\c/../d.pdf","d.pdf"],
  ["..","download"],[".","download"],["/","download"],
  ["..\\","download"],["/..","download"],["file.txt\0.exe","file.txt.exe"],
  ["", "download"],["report.pdf","report.pdf"],
  ["résumé.pdf","résumé.pdf"],["文档.pdf","文档.pdf"]
 ];
 for(const [name,expected] of fixtures)assert.equal(sanitizeBrowserDownloadFilename(name),expected);
 assert.throws(()=>sanitizeBrowserDownloadFilename("x".repeat(2001)));
});
test("browser output containment rejects sibling-prefix, ../ traversal and root itself",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-browser-download-"));
 try{
  const inside=path.join(root,"a.txt");fs.writeFileSync(inside,"a");
  const sibling=root+"-sibling",outside=path.join(sibling,"a.txt");
  fs.mkdirSync(sibling);fs.writeFileSync(outside,"b");
  try{
   assert.equal(assertBrowserDownloadInsideRoots(inside,[root]),inside);
   assert.throws(()=>assertBrowserDownloadInsideRoots(outside,[root]),/escaped/);
   assert.throws(()=>assertBrowserDownloadInsideRoots(path.join(root,"..","outside.txt"),[root]),/escaped/);
   assert.throws(()=>assertBrowserDownloadInsideRoots(root,[root]),/escaped/);
   assert.throws(()=>assertBrowserDownloadInsideRoots("relative.txt",[root]),/absolute/);
  }finally{fs.rmSync(sibling,{recursive:true,force:true})}
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test("browser output containment rejects a symlink inside allowed root targeting outside",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-browser-symlink-"));
 const target=path.join(root,"..","not-approved-"+path.basename(root));
 fs.writeFileSync(target,"secret");
 try{
  const link=path.join(root,"symlink.txt");fs.symlinkSync(target,link);
  assert.throws(()=>assertBrowserDownloadInsideRoots(link,[root]),/escaped/);
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(target,{force:true})}
});
