import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const c = new URL("../client/src/", import.meta.url);
const read = name => fs.readFileSync(new URL(name, c), "utf8");
const dialog = read("components/terminal/WorkSearchDialog.tsx");
const chat = read("components/terminal/ProjectExperienceShell.tsx");
const terminal = read("pages/Terminal.tsx");
const ownership = read("lib/workSearchNavigationPolicy.ts");
const filters = read("lib/workSearchFilters.ts");
const server = fs.readFileSync(new URL("../server/workSearch.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../shared/workSearch.ts", import.meta.url), "utf8");

test("WS-17 retains #114 filtered, validated and permission-scoped server results", () => {
  assert.match(dialog, /WORK_SEARCH_FILTERS/);
  assert.match(dialog, /visibleResults = useMemo/);
  assert.match(dialog, /workSearchResponseSchema.parse/);
  assert.match(dialog, /encodeURIComponent\(normalized\)/);
  assert.match(dialog, /\/api\/work-search/);
  assert.match(filters, /already-authorized, server-returned work/);
  assert.doesNotMatch(dialog, /localStorage|sessionStorage/);
});

test("WS-17 backend tenant restriction governs all five queried record types", () => {
  assert.match(server, /function tenantClause/);
  assert.equal((server.match(/tenantClause\(/g) ?? []).length, 6);
  assert.match(server, /eq\(projectChats.status, "active"\)/);
  assert.match(server, /isNull\(projectArtifacts.trashedAt\)/);
  assert.match(server, /isNull\(projectResources.trashedAt\)/);
  assert.match(server, /return workSearchResponseSchema.parse/);
  assert.match(schema, /export const workSearchResultSchema = z.object/);
  assert.match(schema, /\.strict\(\)/);
});

test("WS-17 canceled draft switch never dismisses open authorized search", () => {
  assert.match(dialog, /onSelect: \(result: WorkSearchResult\) => boolean \| Promise<boolean>/);
  assert.match(dialog, /const opened = await onSelect\(result\)/);
  assert.match(dialog, /if \(shouldCloseSearchAfterNavigation\(opened\)\) onClose\(\)/);
  assert.match(dialog, /else inputRef.current\?\.focus\(\)/);
  assert.match(ownership, /return opened === true/);
  assert.match(chat, /const openWorkSearchResult = async \(result: WorkSearchResult\): Promise<boolean>/);
  assert.match(chat, /return await openChat\(chat\)/);
});

test("WS-17 saved Chat must match owner, Project, scope and active status", () => {
  assert.match(ownership, /result.chatId === chat.id/);
  assert.match(ownership, /result.projectId === chat.projectId/);
  assert.match(ownership, /chat.scope === \(chat.projectId === null \? "quick" : "project"\)/);
  assert.match(ownership, /chat.status === "active"/);
  assert.match(ownership, /chat.trashedAt === null/);
  assert.match(chat, /if \(!matchesSavedSearchChat\(result, chat\)\) throw new Error/);
});

test("WS-17 Quick Artifact validates exact record before asking to discard work", () => {
  const area = chat.slice(chat.indexOf('if (result.kind === "artifact" && result.projectId === null'), chat.indexOf('if (result.kind === "chat" && result.chatId)'));
  assert.match(area, /const response = await fetch/);
  assert.match(area, /const exact = await fetch/);
  assert.match(area, /matchesSavedSearchChat\(result, chat\)/);
  assert.match(area, /detail.artifact\?\.id !== result.artifactId/);
  assert.match(area, /detail.artifact\?\.owningChatId !== chat.id/);
  assert.ok(area.indexOf("detail.artifact?.owningChatId") < area.indexOf("await confirmConversationSwitch()"));
  assert.match(area, /return await openChat\(chat, true\)/);
});

test("WS-17 Project, File and Artifact targets require concrete authorized identities", () => {
  const area = chat.slice(chat.indexOf('if (result.projectId) {', chat.indexOf('const openWorkSearchResult')), chat.indexOf('const handleChatLifecycleAction'));
  assert.match(area, /project.id !== result.projectId \|\| project.status !== "active" \|\| project.trashedAt/);
  assert.match(area, /return \(await openProject\(project, false, true\)\) === true/);
  assert.match(area, /const exactTarget = resolveWorkSearchLibraryTarget\(result\)/);
  assert.match(area, /if \(!exactTarget\) throw new Error/);
  assert.match(area, /if \(selection.projectId !== project.id && !\(await openProject\(project\)\)\) return false/);
  assert.match(area, /setLibrarySelection\(/);
  assert.match(area, /return true/);
});

test("WS-17 keyboard, IME, Escape, and focus restoration extend existing #114 semantics", () => {
  assert.match(dialog, /role="combobox"/);
  assert.match(dialog, /role="listbox" aria-label="Matching LiOS work"/);
  assert.match(dialog, /aria-activedescendant=/);
  assert.match(dialog, /aria-keyshortcuts="ArrowDown ArrowUp Enter Escape"/);
  assert.match(dialog, /aria-describedby=\{keyboardHelpId\}/);
  assert.match(dialog, /if \(event.nativeEvent.isComposing\) return/);
  assert.match(dialog, /onCloseAutoFocus=\{\(event\) => \{ if \(returnFocus.current\?\.isConnected\)/);
  assert.match(dialog, /returnFocus.current.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialog, /role="group" aria-label="Filter returned results by type"/);
});

test("WS-17 saved-work keyboard shortcut remains distinct from QuickSwitcher", () => {
  assert.match(terminal, /event.key.toLowerCase\(\) === "k" && modifier && event.shiftKey && isProjectsSurface/);
  assert.match(terminal, /window.dispatchEvent\(new Event\("lios:open-work-search"\)\)/);
  assert.match(chat, /window.addEventListener\("lios:open-work-search", openSearch\)/);
  assert.match(chat, /<WorkSearchDialog/);
  assert.match(chat, /onSelect=\{openWorkSearchResult\}/);
  assert.match(terminal, /<QuickSwitcher tabs=\{tabsState.tabs\}/);
  assert.doesNotMatch(ownership, /fetch\(|apiRequest\(|localStorage/);
});

test("WS-17 source tests do not claim native acceptance or prior PRs merged", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS17_SEARCH_OPEN_CANCELLATION_2026-10-23.md", import.meta.url), "utf8");
  for (const pr of ["#101", "#114", "#136", "#137"]) assert.ok(doc.includes(pr));
  assert.match(doc, /200% zoom[\s\S]{0,100}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,100}NOT_RUN/);
});
