import assert from "node:assert/strict";
import { test } from "node:test";

function hasPrefix(buffer:Buffer, bytes:number[]):boolean{return buffer.length>=bytes.length&&bytes.every((b,i)=>buffer[i]===b);}
function validateFileSignature(buffer:Buffer,ext:string):string|null{
  if(ext==="pdf") return hasPrefix(buffer,[0x25,0x50,0x44,0x46])?null:"invalid pdf";
  if(ext==="csv") return buffer.includes(0)?"binary csv":null;
  if(ext==="xlsx") return hasPrefix(buffer,[0x50,0x4b,0x03,0x04])||hasPrefix(buffer,[0x50,0x4b,0x05,0x06])||hasPrefix(buffer,[0x50,0x4b,0x07,0x08])?null:"invalid xlsx";
  return "unsupported";
}

test("rejects a PDF extension with non-PDF content",()=>{
  assert.equal(validateFileSignature(Buffer.from("not a pdf"),"pdf"),"invalid pdf");
});
test("accepts a PDF signature",()=>{
  assert.equal(validateFileSignature(Buffer.from("%PDF-1.7"),"pdf"),null);
});
test("rejects an XLSX extension with non-ZIP content",()=>{
  assert.equal(validateFileSignature(Buffer.from("plain text"),"xlsx"),"invalid xlsx");
});
test("accepts a ZIP/XLSX container signature",()=>{
  assert.equal(validateFileSignature(Buffer.from([0x50,0x4b,0x03,0x04]),"xlsx"),null);
});
test("rejects binary/NUL CSV payloads",()=>{
  assert.equal(validateFileSignature(Buffer.from([0x41,0x2c,0x42,0x00,0x43]),"csv"),"binary csv");
});
