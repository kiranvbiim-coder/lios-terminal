import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AuthenticatedNavigation } from "./AuthenticatedNavigation";

function render(section: "conversation" | "projects" | "chats" | "library" | "automations" | "plugins", activeSection?: typeof section) {
  const action = () => {};
  return renderToStaticMarkup(createElement(AuthenticatedNavigation, {
    section, activeSection, account: { name: "Test workspace" }, busy: false,
    onSection: action, onNewChat: action, onTemporary: action, onSearch: action,
    onWorkbench: action, onConnectors: action, onSettings: action, onLogout: action,
    onTrash: action, onMigrate: action,
    children: createElement("p", null, "Recent conversations"),
  }));
}

test("real React render includes named destination links, Work and accessible compact controls", () => {
  const markup = render("conversation");
  assert.match(markup, /aria-label="Main navigation"/);
  for (const label of ["Chat", "Projects", "History", "Artifacts", "Automations", "Plugins", "Connections", "Settings", "New chat", "Work"]) {
    assert.ok(markup.includes(label), label + " must render in navigation");
  }
  assert.match(markup, /aria-label="Collapse navigation"/);
  assert.match(markup, /aria-label="Expand navigation"/);
  assert.match(markup, /aria-label="Compact navigation"/);
  assert.match(markup, /aria-label="Account: Test workspace"/);
  assert.match(markup, /data-sidebar-collapsed="false"/);
});

test("real React render marks one correct current section, including project home via override", () => {
  const chat = render("conversation");
  assert.match(chat, /aria-current="page"[^>]*>[^<]*<svg[^>]*>[\s\S]*?<\/svg>Chat<\/button>/);
  const project = render("conversation", "projects");
  assert.match(project, /aria-current="page"[^>]*>[\s\S]*?Projects<\/button>/);
  assert.equal((project.match(/aria-current="page"/g) ?? []).length, 2, "desktop and compact views each expose the current section");
});
