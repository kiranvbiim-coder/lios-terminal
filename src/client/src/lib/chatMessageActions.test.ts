import test from "node:test";
import assert from "node:assert/strict";
import {quoteChatResponse,visibleChatMessageText,copyChatMessageText} from "./chatMessageActions";

test("quote retains unrelated draft, excludes directives and repeated activation is idempotent",()=>{
  const draft="New unsent question";
  const response="Recorded finding [1]. <<NAVIGATE:chart>>";
  const quoted=quoteChatResponse(draft,response);
  assert.ok(quoted.startsWith(draft));
  assert.doesNotMatch(quoted,/NAVIGATE/);
  assert.equal(quoteChatResponse(quoted,response),quoted);
  assert.equal(quoteChatResponse(draft,"<<NAVIGATE:chart>>"),draft);
  assert.ok(quoteChatResponse("","x".repeat(20000)).length<1350);
  assert.equal(visibleChatMessageText("literal << text","user"),"literal << text");
});
test("clipboard refusal cannot report copied message",async()=>{
  assert.equal(await copyChatMessageText(undefined,"text"),false);
  assert.equal(await copyChatMessageText(async()=>{throw Error("denied");},"text"),false);
});
