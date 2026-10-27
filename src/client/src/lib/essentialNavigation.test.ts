import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const navigation = read("../components/terminal/AuthenticatedNavigation.tsx");
const shell = read("../components/terminal/ProjectExperienceShell.tsx");
const styles = read("../lios-product-experience.css");

test("default navigation has readable names for primary destinations", () => {
  for (const [id, label] of [
    ["conversation", "Chat"],
    ["projects", "Projects"],
    ["chats", "History"],
    ["library", "Artifacts"],
    ["automations", "Automations"],
    ["plugins", "Plugins"],
  ]) {
    assert.ok(navigation.includes('["' + id + '", "' + label + '"'), id + " must have a readable visible name");
  }
  for (const action of ["New chat", "Search", "Connections", "Settings"]) {
    assert.ok(navigation.includes(action), action + " must remain discoverable");
  }
  assert.match(navigation, /aria-label="Main navigation"/);
  assert.match(navigation, /aria-current=\{\(props\.activeSection \?\? props\.section\) === id \? "page"/);
  assert.doesNotMatch(navigation, /lios-shortcut.*⌘ K/);
});

test("full navigation is default; compact icons are intentional and accessible", () => {
  assert.match(navigation, /useState\(false\)/);
  assert.match(navigation, /data-sidebar-collapsed=\{collapsed\}/);
  assert.match(navigation, /className="lios-reference-navigation-rail" aria-label="Compact navigation" hidden=\{!collapsed\}/);
  assert.match(navigation, /className="lios-reference-navigation-projects" hidden=\{collapsed\}/);
  assert.match(navigation, /aria-label="Expand navigation"/);
  assert.match(navigation, /aria-label="Collapse navigation"/);
  assert.match(styles, /\.lios-reference-navigation-rail\[hidden\][\s\S]*display:\s*none\s*!important/);
  assert.match(styles, /data-sidebar-collapsed="false"[\s\S]*width:\s*260px\s*!important/);
  assert.match(styles, /data-sidebar-collapsed="true"[\s\S]*\.lios-reference-navigation-rail[\s\S]*width:\s*60px/);
  assert.match(navigation, /aria-label=\{label\} aria-current=\{\(props\.activeSection \?\? props\.section\) === id/);
});

test("Work is accessible directly from both sidebar modes and preserves the original Workbench handoff", () => {
  assert.match(navigation, /className="lios-open-work" onClick=\{\(\) => act\(props\.onWorkbench\)\}/);
  assert.match(navigation, /title="Work" aria-label="Work" onClick=\{props\.onWorkbench\}/);
  assert.match(shell, /onWorkbench=\{onOpenWorkbench\}/);
  assert.match(shell, /navigateWorkbench\(\{ projectId: selection\.projectId, chatId: selection\.chatId, artifactId: conversationArtifactRef, version: displayed\.version \}\)/);
  assert.match(shell, /captureChatWorkbenchOrigin\(chatMode, selection\.projectId, selection\.chatId, symbol\)/);
  assert.match(shell, /const onOpenWorkbench = \(\) => \{\s*if \(busy \|\| busyRef\.current \|\| sendInFlightRef\.current\)/);
  assert.match(shell, /Save or reset unsaved Artifact edits before opening Workbench/);
});

test("compact navigation never loses account access", () => {
  assert.match(navigation, /const accountMenu = \(compact = false\) =>/);
  assert.match(navigation, /\{accountMenu\(\)\}/);
  assert.match(navigation, /\{accountMenu\(true\)\}/);
  assert.match(navigation, /className=\{compact \? "lios-compact-account-trigger" : "lios-account-trigger"\}/);
  assert.match(navigation, /onSelect=\{props\.onLogout\}/);
  assert.match(navigation, /onSelect=\{\(\) => act\(props\.onTemporary\)\}/);
});

test("mobile drawer reuses named navigation, closes on selection, and provides account controls", () => {
  assert.match(navigation, /<Sheet open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.match(navigation, /<SheetTitle className="sr-only">LiOS navigation<\/SheetTitle>/);
  assert.match(navigation, /\{content\(true\)\}/);
  assert.match(navigation, /const act = \(action: \(\) => void\) => \{ action\(\); setOpen\(false\); \}/);
  assert.match(navigation, /onClick=\{\(\) => act\(\(\) => props\.onSection\(id\)\)\}/);
  assert.match(navigation, /onClick=\{\(\) => act\(props\.onConnectors\)\}/);
  assert.match(navigation, /onClick=\{\(\) => act\(props\.onSettings\)\}/);
  assert.match(navigation, /onSelect=\{props\.onLogout\}/);
  assert.match(styles, /@media \(max-width:\s*767px\)[\s\S]*\.lios-authenticated-navigation\s*\{\s*display:\s*none\s*!important/);
});

test("host-initiated navigation observes the same Stop and unsaved-work protections", () => {
  assert.match(shell, /Host shortcuts\/deep links use the same safety rules as sidebar navigation/);
  assert.match(shell, /navigationRequest\.section !== "conversation" && \(busyRef\.current \|\| sendInFlightRef\.current \|\| chatCreationInFlightRef\.current \|\| projectCreationInFlightRef\.current\)/);
  assert.match(shell, /navigationRequest\.section !== "conversation" && artifactDraftDirtyRef\.current/);
  assert.match(shell, /if \(navigationRequest\.section === "conversation"\) setProjectHomeRequested\(false\)/);
  assert.match(styles, /lios-authenticated-navigation \.lios-primary-navigation \{[\s\S]*max-height: min\(58vh, 490px\)/);
  assert.match(styles, /lios-authenticated-navigation \.lios-compact-account-trigger \{[\s\S]*min-height: 40px/);
});

test("navigation actions preserve the right section and avoid losing current work", () => {
  assert.match(shell, /activeSection=\{section === "conversation" && entrySurface === "project-home" \? "projects" : section\}/);
  assert.match(shell, /onSearch=\{requestWorkSearch\}/);
  assert.match(shell, /if \(next === "conversation"\) setProjectHomeRequested\(false\)/);
  assert.match(shell, /next !== "conversation" && \(busy \|\| busyRef\.current \|\| sendInFlightRef\.current \|\| chatCreationInFlightRef\.current/);
  assert.match(shell, /next !== "conversation" && artifactDraftDirtyRef\.current/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(shell, /aria-current=\{selection\.projectId === project\.id && chatMode === "project" \? "page" : undefined\}/);
  assert.match(shell, /projects: "Projects", chats: "History", library: "Artifacts"/);
});

test("Connections and Settings cannot hide active work or local unsaved Artifact edits", () => {
  assert.match(shell, /const openSafeDestination = \(destination: "Connections" \| "Settings", action: \(\) => void\) =>/);
  assert.match(shell, /onConnectors=\{\(\) => openSafeDestination\("Connections", onOpenEnvironment\)\}/);
  assert.match(shell, /onSettings=\{\(\) => openSafeDestination\("Settings", onOpenSettings\)\}/);
  const guard = shell.split('const openSafeDestination = ')[1]?.split('const signOutSafely = ')[0] ?? "";
  assert.match(guard, /busy \|\| busyRef\.current \|\| sendInFlightRef\.current \|\| chatCreationInFlightRef\.current/);
  assert.match(guard, /artifactDraftDirtyRef\.current/);
  assert.match(guard, /action\(\)/);
});

test("Sign out reviews staged unsent work and never silently discards an in-flight response", () => {
  const handler = shell.split('const signOutSafely = async () => {')[1]?.split('const onOpenWorkbench = ')[0] ?? "";
  assert.match(handler, /busy \|\| busyRef\.current \|\| sendInFlightRef\.current/);
  assert.match(shell, /const signingOutRef = useRef\(false\)/);
  assert.match(handler, /if \(signingOutRef\.current\) return/);
  assert.match(handler, /finally \{\s*signingOutRef\.current = false/);
  assert.match(handler, /artifactDraftDirtyRef\.current/);
  assert.match(handler, /confirmConversationSwitch\(true\)/);
  assert.match(handler, /discardConversationDraft\(before\)/);
  assert.match(handler, /onLogout\(\)/);
  assert.match(shell, /onLogout=\{\(\) => void signOutSafely\(\)\}/);
});
