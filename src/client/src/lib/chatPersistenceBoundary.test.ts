import test from "node:test";
import assert from "node:assert/strict";
import { contextForChatMode, savedChatIdForMode, selectionForTemporaryChat, shouldClearSavedChatAddress, sourceScopeForChatMode } from "./chatPersistenceBoundary";
import type { ConversationRequest } from "@shared/conversationRuntime";

const selectedContext: ConversationRequest["context"] = {
  symbol: "PRIVATE", view: "portfolio",
  activeObjectRefs: ["artifact:123e4567-e89b-42d3-a456-426614174000"],
  selection: {kind:"text",id:"selection",label:"Sensitive Project text",text:"Do not import me",view:"portfolio",symbol:"PRIVATE"},
};

test("WS-25 entering Temporary Chat has no saved Project or Chat selection", () => {
  assert.deepEqual(selectionForTemporaryChat(), { projectId:null, chatId:null });
});

test("WS-25 Temporary Chat never inherits selected Project Artifact or private text", () => {
  assert.equal(contextForChatMode("temporary", selectedContext), undefined);
  assert.equal(contextForChatMode("temporary", undefined), undefined);
});

test("WS-25 Quick Chat continues using its own ordinary context boundary", () => {
  assert.equal(contextForChatMode("quick", selectedContext), selectedContext);
});

test("WS-25 Project Chat retains explicitly selected Project context", () => {
  assert.equal(contextForChatMode("project", selectedContext), selectedContext);
});

test("WS-25 Temporary Chat starts Auto rather than inheriting Project private-data source scope", () => {
  for (const scope of ["auto","my_data","files"] as const)
    assert.equal(sourceScopeForChatMode("temporary", scope), "auto");
  assert.equal(sourceScopeForChatMode("temporary", "web"), "web");
});

test("WS-25 Quick and Project Chat source scopes are unchanged", () => {
  for (const mode of ["quick","project"] as const) {
    for (const scope of ["auto","my_data","web","files"] as const)
      assert.equal(sourceScopeForChatMode(mode,scope),scope);
  }
});

test("WS-25 Temporary Chat never queries a saved Chat message store", () => {
  assert.equal(savedChatIdForMode("temporary",100),null);
  assert.equal(savedChatIdForMode("temporary",null),null);
});

test("WS-25 saved Quick/Project Chat ID still enables owner-authorized history retrieval", () => {
  assert.equal(savedChatIdForMode("quick",28),28);
  assert.equal(savedChatIdForMode("project",31),31);
  assert.equal(savedChatIdForMode("quick",null),null);
});

test("WS-25 an old LiOS deep link clears when both saved selections are removed", () => {
  assert.equal(shouldClearSavedChatAddress({projectId:null,chatId:null},true),true);
  assert.equal(shouldClearSavedChatAddress({projectId:null,chatId:8},true),false);
  assert.equal(shouldClearSavedChatAddress({projectId:3,chatId:null},true),false);
});

test("WS-25 unrelated hash anchors are never removed as a side effect", () => {
  assert.equal(shouldClearSavedChatAddress({projectId:null,chatId:null},false),false);
});
