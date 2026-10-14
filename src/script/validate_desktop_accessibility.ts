import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
function read(relative: string): string {
  return fs.readFileSync(path.resolve(cwd, relative), "utf8");
}
function requireMatch(source: string, pattern: RegExp, message: string): void {
  if (!pattern.test(source)) throw new Error(message);
}

const immersive = read("client/src/immersive-terminal.css");
const signature = read("client/src/terminal-signature-v5.css");
const commandBar = read("client/src/components/terminal/CommandBar.tsx");
const dock = read("client/src/components/terminal/ImmersiveDock.tsx");
const workspacePane = read("client/src/components/terminal/WorkspacePane.tsx");
const shortcutOverlay = read("client/src/components/terminal/ShortcutOverlay.tsx");
const tabBar = read("client/src/components/terminal/TerminalTabBar.tsx");
const projectShell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const projectShellUx = read("client/src/terminal-shell.css") + "\n" + read("client/src/components/terminal/project-conversation-shell.css");
const dockviewWorkspace = read("client/src/components/terminal/DockviewWorkspaceGrid.tsx");

requireMatch(
  immersive,
  /button:focus-visible[\s\S]{0,300}outline\s*:/,
  "Core terminal CSS must preserve a visible focus indicator for buttons.",
);
requireMatch(
  immersive + "\n" + signature,
  /:where\([^)]*(?:input|select|textarea)[^)]*\):focus-visible[\s\S]{0,300}outline\s*:/,
  "Core terminal CSS must preserve visible focus indicators for form controls.",
);
requireMatch(
  immersive + "\n" + signature,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
  "Terminal CSS must preserve reduced-motion behavior.",
);

requireMatch(commandBar, /role="dialog"/, "Omnibox must preserve dialog semantics.");
requireMatch(commandBar, /aria-modal="true"/, "Omnibox must preserve aria-modal.");
requireMatch(commandBar, /aria-label="LiOS Omnibox"/, "Omnibox needs a stable accessible label.");
requireMatch(commandBar, /onKeyDown=\{handleKey\}/, "Omnibox must preserve keyboard navigation.");
requireMatch(commandBar, /aria-pressed=\{mode === id\}/, "Omnibox mode controls must expose pressed state.");

const dockLabels = (dock.match(/aria-label=/g) ?? []).length;
if (dockLabels < 8) throw new Error("Immersive dock accessibility labels regressed: found " + dockLabels + ", expected at least 8.");

requireMatch(workspacePane, /capability\.label/, "Workspace pane must preserve its analytical accessible label.");
requireMatch(workspacePane, /aria-label="Close pane"/, "Workspace pane close action needs an accessible label.");
requireMatch(workspacePane, /aria-label=\{isMaximized \? "Restore pane" : "Maximize pane"\}/, "Workspace maximize action needs an accessible state label.");

requireMatch(shortcutOverlay, /aria-label="LIOS keyboard map"/, "Keyboard shortcut overlay needs an accessible label.");
requireMatch(shortcutOverlay, /aria-label="Close keyboard map"/, "Keyboard shortcut overlay close action needs a label.");

requireMatch(tabBar, /aria-label=\{[^}]*Close[^}]*tab\.title[^}]*\}/, "Tab close controls need contextual accessible labels.");
requireMatch(tabBar, /aria-label=\{[^}]*Tab actions for[^}]*tab\.title[^}]*\}/, "Tab action controls need contextual accessible labels.");
requireMatch(tabBar, /aria-pressed=\{linkGroup === group\}/, "Linked-context toggle state must remain exposed.");
requireMatch(tabBar, /aria-label="New terminal tab"/, "New-tab control needs an accessible label.");

requireMatch(projectShell, /aria-label="Send"/, "Project chat composer send action needs an accessible label.");
requireMatch(projectShell, /title="New Project"/, "Project creation action needs a stable accessible name.");
requireMatch(projectShell, /title="Save Session"/, "Session Vault save action needs a stable accessible name.");
requireMatch(read("client/src/components/terminal/WorkSearchDialog.tsx"), /aria-label="Search LiOS work"/, "Project search must have a stable accessible name.");
requireMatch(projectShell, /aria-label="Example prompts"/, "First-use prompt suggestions must be grouped for assistive technology.");
requireMatch(projectShell, /aria-labelledby="lios-chat-empty-title"/, "The empty conversation state needs a semantic heading relationship.");
requireMatch(projectShellUx, /\[class~="text-\[8px\]"\][\s\S]{0,180}font-size:\s*max\(0?\.75rem/, "Project shell microtype must be raised to a readable minimum.");
requireMatch(projectShellUx, /\.lios-project-experience-shell[\s\S]{0,5000}:focus-visible\s*\{[\s\S]{0,180}outline:\s*2px solid/, "Project shell controls need a visible focus ring in the canonical stabilization layer.");
requireMatch(projectShell, /Temporary chat/, "Temporary Chat must remain explicitly identifiable to keyboard/screen-reader users.");
requireMatch(projectShell, /Not saved/, "Temporary Chat must visibly expose its non-persistent state.");
requireMatch(dockviewWorkspace, /DockviewDefaultTab[\s\S]{0,120}hideClose/, "Dockview native close controls must remain hidden so LiOS owns the accessible close action.");
requireMatch(dockviewWorkspace, /WorkspacePane/, "Dockview panels must continue to render through the accessible LiOS WorkspacePane chrome.");

console.log(JSON.stringify({
  contractVersion: "1.0.0",
  focusIndicators: true,
  reducedMotion: true,
  omniboxKeyboardNavigation: true,
  semanticCoreControls: true,
  projectChatAccessibleControls: true,
  dockviewUsesLiOSAccessiblePaneChrome: true,
  dockAccessibleLabels: dockLabels,
  externalEvidenceStillRequired: ["macOS VoiceOver", "Windows Narrator", "keyboard-only packaged app walkthrough"],
}, null, 2));
