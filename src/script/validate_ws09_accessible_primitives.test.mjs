import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = new URL("../client/src/components/ui/", import.meta.url);
const terminal = new URL("../client/src/components/terminal/", import.meta.url);
const read = (base, name) => fs.readFileSync(new URL(name, base), "utf8");
const dialog = read(ui, "dialog.tsx");
const sheet = read(ui, "sheet.tsx");
const menu = read(ui, "dropdown-menu.tsx");
const input = read(ui, "input.tsx");
const button = read(ui, "button.tsx");
const form = read(ui, "form.tsx");
const destination = read(terminal, "ProjectDestinationDialog.tsx");

test("WS-09 keeps Radix dialog focus/escape/overlay authority and explicit title/description primitives", () => {
  assert.match(dialog, /import \* as DialogPrimitive from "@radix-ui\/react-dialog"/);
  assert.match(dialog, /const Dialog = DialogPrimitive\.Root/);
  assert.match(dialog, /<DialogPrimitive\.Content/);
  assert.match(dialog, /<DialogPrimitive\.Close/);
  assert.match(dialog, /const DialogTitle = React\.forwardRef/);
  assert.match(dialog, /const DialogDescription = React\.forwardRef/);
  assert.doesNotMatch(dialog, /window\.addEventListener\(.keydown.|document\.addEventListener\(.keydown./);
});

test("WS-09 dialog content is usable at short/narrow viewports and can scroll without losing close", () => {
  assert.match(dialog, /w-\[calc\(100vw-2rem\)\]/);
  assert.match(dialog, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(dialog, /overflow-y-auto overscroll-contain/);
  assert.match(dialog, /pr-12/);
  assert.match(dialog, /aria-label="Close dialog"/);
  assert.match(dialog, /focus-visible:outline-ring/);
  assert.match(dialog, /motion-reduce:animate-none/);
});

test("WS-09 drawer retains Radix modal semantics with viewport bound and visible close control", () => {
  assert.match(sheet, /import \* as SheetPrimitive from "@radix-ui\/react-dialog"/);
  assert.match(sheet, /max-h-\[100dvh\] overflow-y-auto overscroll-contain/);
  assert.match(sheet, /max-w-\[calc\(100vw-1rem\)\]/);
  assert.match(sheet, /aria-label="Close panel"/);
  assert.match(sheet, /focus-visible:outline-ring/);
  assert.match(sheet, /motion-reduce:animate-none/);
});

test("WS-09 main and submenu use the existing Radix keyboard/portal lifecycle with bounded menu size", () => {
  assert.match(menu, /const DropdownMenu = DropdownMenuPrimitive\.Root/);
  assert.match(menu, /<DropdownMenuPrimitive\.Portal>/);
  assert.match(menu, /<DropdownMenuPrimitive\.SubContent/);
  const caps = menu.match(/max-w-\[calc\(100vw-1rem\)\]/g) ?? [];
  assert.equal(caps.length, 2, "Both menu and submenu need a narrow-viewport cap");
  const height = menu.match(/max-h-\[var\(--radix-dropdown-menu-content-available-height\)\]/g) ?? [];
  assert.equal(height.length, 2, "Both main and submenus must be scrollable at 200% zoom");
  assert.match(menu, /overscroll-contain/);
});

test("WS-09 the shared menu item, checkbox, radio and submenu triggers have target minimums", () => {
  assert.match(menu, /flex min-h-10 cursor-default/);
  assert.match(menu, /relative flex min-h-10 cursor-default/);
  assert.match(menu, /<DropdownMenuPrimitive\.CheckboxItem/);
  assert.match(menu, /<DropdownMenuPrimitive\.RadioItem/);
  assert.match(menu, /<DropdownMenuPrimitive\.ItemIndicator>/);
  assert.match(menu, /<DropdownMenuPrimitive\.SubTrigger/);
});

test("WS-09 shared field keeps keyboard focus, accessible invalid semantics and no secret telemetry", () => {
  assert.match(input, /min-h-10 w-full min-w-0/);
  assert.match(input, /aria-\[invalid=true\]:border-destructive/);
  assert.match(input, /aria-\[invalid=true\]:focus-visible:ring-destructive/);
  assert.match(input, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(button, /disabled:pointer-events-none disabled:opacity-50/);
  assert.match(form, /aria-describedby=/);
  assert.match(form, /aria-invalid=\{!!error\}/);
  assert.doesNotMatch(input + button + menu + dialog + sheet, /fetch\(|apiRequest\(|localStorage/);
});

test("WS-09 the real Project destination uses shared Label/Input/Button and accessible failure feedback", () => {
  assert.match(destination, /import \{ Button \} from "@\/components\/ui\/button"/);
  assert.match(destination, /import \{ Input \} from "@\/components\/ui\/input"/);
  assert.match(destination, /import \{ Label \} from "@\/components\/ui\/label"/);
  assert.match(destination, /<Dialog open onOpenChange=/);
  assert.match(destination, /<DialogTitle>Choose a Project<\/DialogTitle>/);
  assert.match(destination, /<DialogDescription>\{description\}<\/DialogDescription>/);
  assert.match(destination, /<Label htmlFor="lios-project-destination-select">/);
  assert.match(destination, /<select id="lios-project-destination-select"/);
  assert.match(destination, /<Input id="lios-project-destination-new-name"/);
  assert.match(destination, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(destination, /aria-describedby=\{error \? "lios-project-destination-error"/);
  assert.match(destination, /id="lios-project-destination-error" role="alert"/);
  assert.match(destination, /<Button type="button" variant="outline"/);
  assert.match(destination, /<Button type="submit"/);
});

test("WS-09 retains exactly-once confirmation and trust boundaries, source tests are not native acceptance", () => {
  assert.match(destination, /if \(pendingRef\.current\) return/);
  assert.match(destination, /setCreated\(project\)/);
  assert.match(destination, /await onConfirm\(project\)/);
  assert.match(destination, /disabled=\{pending \|\| !destination/);
  const notes = fs.readFileSync(new URL("../../docs/ux/LIOS_WS09_SHARED_ACCESSIBLE_CONTROLS_2026-10-23.md", import.meta.url), "utf8");
  assert.match(notes, /Native keyboard\/screen-reader\/200% zoom[\s\S]*NOT_RUN/);
  assert.match(notes, /shadcn/);
  assert.match(notes, /#105/);
  assert.match(notes, /#127/);
});
