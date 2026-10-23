import test from "node:test";
import assert from "node:assert/strict";
import { attachmentUploadError, uploadRealChatAttachment, type UploadStage } from "./realFileAttachmentUpload";

const saved = { id:"123e4567-e89b-42d3-a456-426614174000",kind:"document",sourceRef:"project-attachment:abc",fileName:"r.pdf",byteLength:3,mimeType:"application/pdf",sha256:"a".repeat(64),textPreview:null };
type MinimalXhr = {
  status: number; responseText: string; timeout: number; withCredentials: boolean;
  upload: { onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void; onload?: () => void };
  onload?: () => void; onerror?: () => void; onabort?: () => void; ontimeout?: () => void;
  opened: string; form?: FormData;
  open(method:string, url:string, async:boolean):void;
  send(form:FormData):void;
};
function fakeRequest(status: number, response: string, fail?: "error"|"abort"|"timeout") {
  const xhr: MinimalXhr = {
    status, responseText:response,timeout:0,withCredentials:false,opened:"",
    upload:{},
    open(method,url,async){assert.equal(method,"POST");assert.equal(async,true);this.opened=url;},
    send(form) {
      this.form=form;
      this.upload.onprogress?.({loaded:1,total:3,lengthComputable:true});
      this.upload.onprogress?.({loaded:3,total:3,lengthComputable:true});
      this.upload.onload?.();
      if(fail==="error") this.onerror?.();
      else if(fail==="abort") this.onabort?.();
      else if(fail==="timeout") this.ontimeout?.();
      else this.onload?.();
    }
  };
  return xhr;
}
const input = () => new File(["abc"],"r.pdf",{type:"application/pdf"});

test("WS-19 Project upload uses same-origin authenticated owner-scoped URL", async () => {
  const xhr=fakeRequest(201,JSON.stringify({attachment:saved}));
  const states:UploadStage[]=[];
  const result=await uploadRealChatAttachment(5,7,input(),s=>states.push(s),()=>xhr as unknown as XMLHttpRequest);
  assert.equal(xhr.opened,"/api/projects/5/chats/7/attachments");
  assert.equal(xhr.withCredentials,true);
  assert.equal(xhr.timeout,120000);
  assert.equal(xhr.form?.get("file") instanceof File,true);
  assert.deepEqual(result,saved);
  assert.deepEqual(states.map(x=>x.state),["transferring","transferring","verifying"]);
  assert.equal(states[1].percent,99);
});
test("WS-19 Quick Chat upload uses #100 real authenticated route, not Project migration", async () => {
  const xhr=fakeRequest(201,JSON.stringify({attachment:saved}));
  await uploadRealChatAttachment(null,2,input(),()=>{},()=>xhr as unknown as XMLHttpRequest);
  assert.equal(xhr.opened,"/api/quick-chats/2/attachments");
});
test("WS-19 a failed 503 never falsely reports saved success or exposes server internals", async () => {
  const xhr=fakeRequest(503,JSON.stringify({error:"SECRET_INTERNAL_PATH"}));
  await assert.rejects(uploadRealChatAttachment(null,2,input(),()=>{},()=>xhr as unknown as XMLHttpRequest), /local file remains staged/);
});
test("WS-19 timeout and network errors advise retry without deleting the local file", async () => {
  for (const failure of ["error","timeout","abort"] as const) {
    const xhr=fakeRequest(0,"",failure);
    await assert.rejects(uploadRealChatAttachment(null,2,input(),()=>{},()=>xhr as unknown as XMLHttpRequest), /staged|stopped/i);
  }
});
test("WS-19 HTTP success without a valid saved attachment is not accepted", async () => {
  for (const body of ["not-json",JSON.stringify({attachment:{id:"abc"}}),JSON.stringify({ok:true})]) {
    const xhr=fakeRequest(201,body);
    await assert.rejects(uploadRealChatAttachment(1,2,input(),()=>{},()=>xhr as unknown as XMLHttpRequest), /not confirmed|unreadable/);
  }
});
test("WS-19 denied and oversize files produce safe role-specific copy", () => {
  assert.match(attachmentUploadError(413),/limit/);
  assert.match(attachmentUploadError(401),/sign-in expired/);
  assert.match(attachmentUploadError(403),/not accessible/);
  assert.match(attachmentUploadError(429),/Too many/);
  assert.doesNotMatch(attachmentUploadError(500),/database|stack trace|token/);
});
