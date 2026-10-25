import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const shell = read("client/src/terminal-shell.css");
const project = read("client/src/components/terminal/project-conversation-shell.css");
const sidecar = read("client/src/components/terminal/ConversationArtifactSidecar.tsx");
const resizing = read("client/src/lib/conversationSidecarSizing.ts");
const owned = shell.slice(shell.lastIndexOf("TC/UX WS-59:"));

test("WS-59 zoom-equivalent mobile viewport switches 260px rail to accessible Sheet", () => {
  assert.match(owned, /@media \(max-width: 1023px\)/);
  assert.match(owned, /\.terminal-root \.lios-authenticated-navigation \{ display: none !important; \}/);
  assert.match(owned, /\.lios-mobile-navigation \{/);
  assert.match(owned, /max-height: 100dvh/);
  assert.match(owned, /\.lios-navigation-sheet \.lios-navigation-history/);
  assert.match(project, /\.lios-navigation-sheet/);
});

test("WS-59 Artifact does not maintain a 320px sidecar plus fixed rail on narrow windows", () => {
  assert.match(owned, /\.lios-project-chat-surface \{\s*flex-direction: column/);
  assert.match(owned, /\.lios-project-chat-surface > \.lios-artifact-sidecar/);
  assert.match(owned, /width: 100% !important/);
  assert.match(owned, /min-width: 0 !important/);
  assert.match(owned, /max-width: none !important/);
  assert.match(owned, /overflow-y: auto/);
  assert.match(owned, /\[role="separator"\] \{\s*display: none/);
  assert.match(sidecar, /min\(80%, max\(320px, calc\(100% - 360px\)\)\)/);
  assert.match(sidecar, /clampConversationSidecarWidth/);
  assert.match(resizing, /MIN_CONVERSATION_WIDTH = 360/);
});

test("WS-59 320/375/390 and low-height zoom do not clip critical controls", () => {
  assert.match(owned, /@media \(max-width: 410px\)/);
  assert.match(owned, /@media \(max-height: 600px\) and \(max-width: 1023px\)/);
  assert.match(owned, /\.lios-conversation-header \{\s*flex-wrap: wrap/);
  assert.match(owned, /\.lios-conversation-composer-actions \{[\s\S]*?flex-wrap: wrap/);
  assert.match(owned, /\.lios-section-surface > header \{\s*flex-wrap: wrap/);
  assert.match(owned, /overflow-wrap: anywhere/);
  assert.match(owned, /min-inline-size: 0/);
});

test("WS-59 preserves reduced motion, Focus and native verification boundaries", () => {
  assert.match(project, /prefers-reduced-motion/);
  assert.match(sidecar, /onExitFocus/);
  assert.match(sidecar, /<ArtifactPane/);
  assert.match(sidecar, /role="separator"/);
  assert.doesNotMatch(owned, /display:\s*none[^;]*;\s*\/\* hide Artifact/);
});
