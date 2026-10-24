import test from "node:test";
import assert from "node:assert/strict";
import { planAttachmentStage, progressPercent, stagedFileKey } from "./fileAttachmentStaging";

const file = (name: string, size = 1024, lastModified = 1) => ({ name, size, lastModified });
test("WS-19 accepts up to five actual staged documents", () => {
  const input = ["pdf","docx","pptx","xlsx","csv"].map((ext,i)=>file(`file${i}.${ext}`));
  const stage = planAttachmentStage([], input, 0);
  assert.equal(stage.error, null);
  assert.equal(stage.files.length, 5);
});
test("WS-19 repeat file selection or drag/drop does not double count one upload", () => {
  const first = file("report.pdf");
  assert.deepEqual(planAttachmentStage([first],[first],0), { files:[first], error:null });
  assert.equal(stagedFileKey(first), stagedFileKey({ ...first }));
});
test("WS-19 five-cap counts already uploaded server references", () => {
  assert.match(planAttachmentStage([], [file("a.pdf"),file("b.pdf")], 4).error ?? "", /five files/);
  assert.equal(planAttachmentStage([], [file("a.pdf")], 4).files.length, 1);
});
test("WS-19 a batch is rejected atomically and never drops existing staged files", () => {
  const current=[file("current.txt")];
  const result=planAttachmentStage(current,[file("another.csv"),file("malware.exe")],0);
  assert.deepEqual(result.files,current);
  assert.match(result.error ?? "", /Unsupported/);
});
test("WS-19 rejects empty, over-20MiB and invalid-size uploads", () => {
  for (const size of [0,-1,Infinity,NaN,20*1024*1024+1]) {
    assert.notEqual(planAttachmentStage([], [file("report.pdf", size)],0).error,null);
  }
});
test("WS-19 images are capped at 6 MiB without reducing document limit", () => {
  assert.match(planAttachmentStage([], [file("image.png",6*1024*1024+1)],0).error??"",/6 MiB/);
  assert.equal(planAttachmentStage([], [file("model.xlsx",12*1024*1024)],0).error,null);
});
test("WS-19 upper-case extensions and supported text/images remain valid", () => {
  for (const ext of ["PDF","md","json","tsv","txt","jpg","jpeg","webp"]) {
    assert.equal(planAttachmentStage([], [file(`a.${ext}`)],0).error,null);
  }
});
test("WS-19 a byte upload is at most 99% until server confirms", () => {
  assert.equal(progressPercent(50,100,true),50);
  assert.equal(progressPercent(100,100,true),99);
  assert.equal(progressPercent(999,100,true),99);
  assert.equal(progressPercent(0,0,false),null);
  assert.equal(progressPercent(8,NaN,true),null);
});
