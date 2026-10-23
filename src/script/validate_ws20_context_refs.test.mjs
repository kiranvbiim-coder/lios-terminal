import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../client/src/", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), "utf8");
const chat = read("components/terminal/ProjectExperienceShell.tsx");
const source = read("components/terminal/ChatSourcesControl.tsx");
const shared = fs.readFileSync(new URL("../shared/mentionContext.ts", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../server/conversationRuntime.ts", import.meta.url), "utf8");
const core = fs.readFileSync(new URL("../server/conversationRuntimeCore.ts", import.meta.url), "utf8");
const serverTests = fs.readFileSync(new URL("../server/conversationRuntime.test.ts", import.meta.url), "utf8");

test("WS-20 only one editor/server mention syntax; emails are not @references", () => {
  assert.match(core, /export \{ normalizedMentionToken, userMentionTokens \} from "@shared\/mentionContext"/);
  assert.match(runtime, /import \{ ambiguousMentionTokens \} from "@shared\/mentionContext"/);
  assert.match(shared, /message\.matchAll\(\/\(\?:\^\|\\s\)@\(/);
  assert.match(shared, /export function latestMentionQuery/);
  assert.match(chat, /import \{ ambiguousMentionTokens, eligibleProjectMentions, stageResourceMention \}/);
});

test("WS-20 suggestions require current Project, unarchived owned resources, source sharing and disambiguation", () => {
  assert.match(shared, /chatMode !== "project" \|\| projectId === null \|\| !allowResourceReferences/);
  assert.match(shared, /sourceScope !== "auto" && sourceScope !== "my_data"/);
  assert.match(shared, /resource\.projectId === projectId/);
  assert.match(shared, /resource\.status === "active" && !resource\.trashedAt/);
  assert.match(shared, /resource\.contextMode !== "excluded"/);
  assert.match(shared, /counts\.get\(token\) === 1/);
  assert.match(chat, /eligibleProjectMentions\(resources, input, selection\.projectId, chatMode, sourceScope, transmissionPolicy\.allowResourceReferences\)/);
});

test("WS-20 selecting a named resource only stages editable text, not an implicit API grant", () => {
  assert.match(shared, /export function stageResourceMention\(current: string, label: string\)/);
  assert.match(chat, /if \(!mentionCandidates\.some\(candidate => candidate\.id === resource\.id\)\) return/);
  assert.match(chat, /setInput\(current => stageResourceMention\(current, resource\.label\)\)/);
  assert.match(chat, /requestAnimationFrame\(\(\) => composerRef\.current\?\.focus\(\)\)/);
  assert.doesNotMatch(shared, /fetch\(|apiRequest\(|localStorage|sessionStorage/);
});

test("WS-20 ambiguous hand-typed mention blocks Send without modifying unsent content", () => {
  const send = chat.slice(chat.indexOf("const send = async ("), chat.indexOf("const approveRuntimeAction =", chat.indexOf("const send = async (")));
  assert.match(send, /const ambiguous = ambiguousMentionTokens\(owned, message\)/);
  assert.match(send, /Rename the duplicate resources or remove the mention before sending; your draft has not changed/);
  assert.ok(send.indexOf("ambiguousMentionTokens(owned, message)") < send.indexOf("await runCommand(message)"));
  assert.match(send, /sourceScope === "auto" \|\| sourceScope === "my_data"/);
  assert.match(send, /transmissionPolicy\.allowResourceReferences/);
});

test("WS-20 server refuses duplicate on-demand name matches but preserves explicit attached and Project references", () => {
  assert.match(runtime, /const ambiguous = new Set\(ambiguousMentionTokens\(resources, message\)\)/);
  assert.match(runtime, /return !ambiguous\.has\(token\) && mentions\.has\(token\)/);
  assert.match(runtime, /if \(sourceScope === "web"\) return \[\]/);
  assert.match(runtime, /if \(sourceScope === "files"\) return explicitlyAttached/);
  assert.match(runtime, /if \(resource\.contextMode === "project"\) return true/);
  assert.match(serverTests, /WS-20 duplicate on-demand label/);
  assert.match(serverTests, /WS-20 email address/);
});

test("WS-20 existing slash commands remain explicitly staged or user submitted, not auto dispatched on suggestion click", () => {
  assert.match(chat, /const commandCandidates = useMemo/);
  assert.match(chat, /QUICK_COMMANDS\.find\(\(item\) => item\.command === token\.toLowerCase\(\)\)/);
  assert.match(chat, /Stage command \$\{item\.command\}/);
  assert.match(chat, /setInput\(item\.command\); requestAnimationFrame/);
  assert.match(chat, /Selecting only stages editable text/);
  assert.match(chat, /onClick=\{\(\) => selectMention\(resource\)\}/);
});

test("WS-20 original source registry and source-scope policy remain the single permission authority", () => {
  assert.match(source, /\/api\/setup\/source-registry/);
  assert.match(source, /Connection state is not permission to send data to AI/);
  assert.match(chat, /sourceScope === "files" && !hasStagedAttachments/);
  assert.match(chat, /sourceScope === "web" && hasStagedAttachments/);
  assert.match(runtime, /input\.request\.transmissionPolicy\.allowResourceReferences/);
});

test("WS-20 exact project/permission/native acceptance is not confused with source coverage", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS20_CONTEXT_REFERENCES_2026-10-23.md", import.meta.url), "utf8");
  assert.match(doc, /#98/);
  assert.match(doc, /#139/);
  assert.match(doc, /200% zoom[\s\S]{0,80}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,80}NOT_RUN/);
});
