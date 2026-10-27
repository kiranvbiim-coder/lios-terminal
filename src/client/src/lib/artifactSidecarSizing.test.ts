import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ARTIFACT_KEYBOARD_STEP,
  artifactSidecarBounds,
  canExpandArtifactRevision,
  clampArtifactSidecarWidth,
  keyboardArtifactSidecarWidth,
  isCurrentArtifactLoad,
} from "./artifactSidecarSizing";

test("WS-36 sidecar never steals the minimum readable Chat space", () => {
  assert.deepEqual(artifactSidecarBounds(1200), { min: 320, max: 840 });
  assert.deepEqual(artifactSidecarBounds(900), { min: 320, max: 540 });
  assert.deepEqual(artifactSidecarBounds(800), { min: 320, max: 440 });
  assert.deepEqual(artifactSidecarBounds(680), { min: 320, max: 320 });
  assert.deepEqual(artifactSidecarBounds(500), { min: 140, max: 140 });
  assert.deepEqual(artifactSidecarBounds(0), { min: 0, max: 0 });
  assert.deepEqual(artifactSidecarBounds(Number.NaN), { min: 0, max: 0 });
  for (const width of [0, 250, 600, 900, 1280, 1800]) {
    const result = artifactSidecarBounds(width);
    assert.ok(result.min >= 0 && result.min <= result.max);
    assert.ok(result.max <= width * 0.8);
  }
});

test("WS-36 pointer and keyboard sizing clamps both ends under zoom and narrow windows", () => {
  assert.equal(clampArtifactSidecarWidth(3000, 1200), 840);
  assert.equal(clampArtifactSidecarWidth(-99, 1200), 320);
  assert.equal(clampArtifactSidecarWidth(Number.NaN, 1200), 320);
  assert.equal(clampArtifactSidecarWidth(521.8, 1200), 522);
  assert.equal(keyboardArtifactSidecarWidth("ArrowLeft", 500, 900), 540);
  assert.equal(keyboardArtifactSidecarWidth("ArrowRight", 500, 900), 460);
  assert.equal(keyboardArtifactSidecarWidth("ArrowLeft", 500, 900, true), 540);
  assert.equal(keyboardArtifactSidecarWidth("ArrowRight", 500, 900, true), 420);
  assert.equal(keyboardArtifactSidecarWidth("Home", 520, 1200), 320);
  assert.equal(keyboardArtifactSidecarWidth("End", 520, 1200), 840);
  assert.equal(keyboardArtifactSidecarWidth("Tab", 500, 900), null);
  assert.equal(ARTIFACT_KEYBOARD_STEP, 40);
});

test("WS-36 exact revision and unsaved draft must both authorize Expand", () => {
  const loaded = { artifactId: "artifact:11111111-1111-4111-8111-111111111111", requestedVersion: 3, version: 3 };
  assert.equal(canExpandArtifactRevision(loaded, loaded.artifactId, 3, false), true);
  assert.equal(canExpandArtifactRevision(loaded, loaded.artifactId, 3, true), false);
  assert.equal(canExpandArtifactRevision(loaded, loaded.artifactId, 4, false), false);
  assert.equal(canExpandArtifactRevision(loaded, "artifact:22222222-2222-4222-8222-222222222222", 3, false), false);
  assert.equal(canExpandArtifactRevision(null, loaded.artifactId, 3, false), false);
  assert.equal(canExpandArtifactRevision({ ...loaded, version: 0 }, loaded.artifactId, 3, false), false);
  assert.equal(canExpandArtifactRevision({ ...loaded, version: 5 }, loaded.artifactId, 3, false), false);
  assert.equal(canExpandArtifactRevision({ ...loaded, requestedVersion: null, version: 5 }, loaded.artifactId, null, false), true);
});

test("WS-36 original sidecar preserves one ArtifactPane, native pointer capture, keyboard back and dirty-draft lock", () => {
  const src = readFileSync(new URL("../components/terminal/ConversationArtifactSidecar.tsx", import.meta.url), "utf8");
  assert.equal((src.match(/<ArtifactPane /g) ?? []).length, 1);
  assert.match(src, /role="separator"/);
  assert.match(src, /aria-valuenow=/);
  assert.match(src, /aria-valuemin=/);
  assert.match(src, /aria-valuemax=/);
  assert.match(src, /onKeyDown=\{event =>/);
  assert.match(src, /keyboardArtifactSidecarWidth\(/);
  assert.match(src, /new ResizeObserver\(measure\)/);
  assert.match(src, /setPointerCapture\(event.pointerId\)/);
  assert.match(src, /onPointerCancel=\{event => endDrag\(event, true\)\}/);
  assert.match(src, /releasePointerCapture\(current.pointerId\)/);
  assert.match(src, /event.key !== "Escape"/);
  assert.match(src, /onDirtyChange=\{value => \{ setDirty\(value\); props.onDirtyChange\?\.\(value\); \}\}/);
  assert.match(src, /disabled=\{!canExpand\}/);
  assert.match(src, /if \(canExpand && displayed\) onExpand\(displayed.version\)/);
  assert.match(src, /exitFocusRef.current\?\.focus\(\)/);
  assert.match(src, /onClick=\{onExitFocus\}/);
  assert.match(src, /--lios-sidecar-width/);
  assert.doesNotMatch(src, /localStorage|createArtifactVersion|persistConversationDraft|window.innerWidth/);
});

test("WS-36 returning to Chat restores keyboard focus and Workbench still refuses a stale/dirty revision", () => {
  const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /reopenArtifactFocusRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(shell, /ref=\{reopenArtifactFocusRef\}/);
  assert.match(shell, /onExitFocus=\{\(\) => \{ setArtifactFocusMode\(false\); requestAnimationFrame\(\(\) => reopenArtifactFocusRef.current\?\.focus\(\)\); \}\}/);
  assert.match(shell, /onExpand=\{\(version\) => \{ displayedArtifactRef.current/);
  assert.match(shell, /if \(artifactDraftDirtyRef.current\) \{ setLifecycleNotice\("Save or reset unsaved Artifact edits before opening Workbench/);
  assert.match(shell, /displayed\?\.artifactId !== conversationArtifactRef \|\| displayed.requestedVersion !== artifactViewVersion/);
  assert.match(shell, /navigateWorkbench\(\{ projectId: selection.projectId, chatId: selection.chatId, artifactId: conversationArtifactRef, version: displayed.version \}\)/);
});

test("only the exact current P4 load can notify the Chat Workbench handoff", () => {
  const a = "artifact:11111111-1111-4111-8111-111111111111";
  const b = "artifact:22222222-2222-4222-8222-222222222222";
  assert.equal(isCurrentArtifactLoad(a, 3, 3, a, 3), true);
  assert.equal(isCurrentArtifactLoad(a, null, 7, a, null), true);
  assert.equal(isCurrentArtifactLoad(a, 3, 3, a, 4), false, "late revision A cannot overwrite requested B");
  assert.equal(isCurrentArtifactLoad(a, null, 7, a, 4), false, "latest must not overwrite an explicit revision");
  assert.equal(isCurrentArtifactLoad(a, 3, 3, a, null), false, "old pinned revision is not the current latest-mode load");
  assert.equal(isCurrentArtifactLoad(b, 3, 3, a, 3), false, "another Artifact cannot take the handoff");
  assert.equal(isCurrentArtifactLoad(a, 4, 3, a, 4), false, "a mismatched server revision is never accepted");
  assert.equal(isCurrentArtifactLoad(a, null, 0, a, null), false);
  assert.equal(isCurrentArtifactLoad(a, null, Number.NaN, a, null), false);
  assert.equal(isCurrentArtifactLoad(a, null, 1.5, a, null), false);
});

test("sidecar refuses stale callbacks before notifying the parent or enabling expansion", () => {
  const sidecar = readFileSync(new URL("../components/terminal/ConversationArtifactSidecar.tsx", import.meta.url), "utf8");
  assert.match(sidecar, /if \(!isCurrentArtifactLoad\(artifactId, loadedRequest, version, props\.artifactId, requestedVersion\)\) return;/);
  const start = sidecar.indexOf("onDisplayedVersionChange={(version, artifactId, loadedRequest) => {");
  const end = sidecar.indexOf("props.onDisplayedVersionChange?.(version, artifactId, loadedRequest);", start);
  assert.ok(start > 0 && end > start);
  const region = sidecar.slice(start, end);
  assert.ok(region.indexOf("isCurrentArtifactLoad(") < region.indexOf("setDisplayed("));
  assert.ok(region.indexOf("isCurrentArtifactLoad(") < region.indexOf("props.onDisplayedVersionChange"), "stale loads never reach the parent");
  assert.match(sidecar, /disabled=\{!canExpand\}/);
  assert.match(sidecar, /if \(canExpand && displayed\) onExpand\(displayed\.version\)/);
  assert.ok((sidecar.match(/min-h-11/g) ?? []).length >= 3);
});

test("parent Chat records only the currently requested Artifact load for Workbench shortcut", () => {
  const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /onDisplayedVersionChange=\{\(version, artifactId, loadedRequest\) => \{/);
  assert.match(shell, /isCurrentArtifactLoad\(artifactId, loadedRequest, version, conversationArtifactRef, artifactViewVersion\)/);
  assert.match(shell, /displayedArtifactRef\.current = \{ artifactId, requestedVersion: loadedRequest, version \}/);
  assert.match(shell, /displayed\?\.artifactId !== conversationArtifactRef \|\| displayed\.requestedVersion !== artifactViewVersion/);
  assert.match(shell, /if \(artifactDraftDirtyRef\.current\)/);
});
