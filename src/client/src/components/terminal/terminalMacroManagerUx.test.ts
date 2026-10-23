import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createTerminalMacro, duplicateTerminalMacro, getBuiltInTerminalMacros,
  resolveTerminalMacro, validateTerminalMacro,
  type TerminalMacroStep,
} from "../../lib/terminalMacros";

const source = readFileSync(new URL("./TerminalMacroManager.tsx", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("./TerminalUxOverlays.tsx", import.meta.url), "utf8");

test("Macro Manager uses an accessible dialog and mobile-selectable workflow list", () => {
  assert.match(source, /from "@\/components\/ui\/dialog"/);
  assert.match(source, /<Dialog open onOpenChange=/);
  assert.match(source, /<DialogTitle/);
  assert.match(source, /<DialogDescription/);
  assert.match(source, /h-\[min\(90dvh,820px\)\]/);
  assert.match(source, /flex-col md:flex-row/);
  assert.match(source, /className="flex items-center gap-2 md:hidden"/);
  assert.match(source, /aria-label="Select workflow"/);
  assert.match(source, /onChange=\{\(event\) => select\(event\.target\.value\)\}/);
  assert.match(source, /New workflow/);
  assert.match(source, /focus-visible:outline/);
  assert.doesNotMatch(source, /text-\[(?:6|7|8|9)px\]/);
});

test("creation, duplicate and edit are drafts until explicitly saved", () => {
  assert.match(source, /setEditing\(createTerminalMacro\(/);
  assert.match(source, /setEditing\(duplicateTerminalMacro\(macro\)\)/);
  assert.match(source, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); saveEdit\(\); \}\}/);
  assert.match(source, /saveCustomTerminalMacros\(next\)/);
  assert.match(source, /if \(!persist\(next\)\) return/);
  assert.match(source, /data-testid="macro-discard-confirm"/);
  assert.match(source, /onEscapeKeyDown=/);
  assert.match(source, /onPointerDownOutside=/);
  assert.match(source, /Unsaved changes discarded/);
  assert.match(source, /Could not save workflow changes on this device/);
});

test("macro runs only by confirmed choice, in order, with no hidden tool bypass", () => {
  assert.match(source, /const hiddenSteps = steps\.filter/);
  assert.match(source, /isCapabilityVisible\(getTerminalCapability\(step\.view\), isInternal\)/);
  assert.match(source, /const canRun = Boolean\(selected && steps\.length && !validateTerminalMacro\(selected\)\.length && !hiddenSteps\.length\)/);
  assert.match(source, /onClick=\{\(\) => setConfirmRun\(true\)\}/);
  assert.match(source, /data-testid="macro-run-confirm"/);
  assert.match(source, /if \(!selected \|\| !confirmRun \|\| !canRun\) return/);
  assert.match(source, /for \(const step of steps\) onRunStep\(step\)/);
  assert.match(source, /execution is disabled/i);
  assert.match(source, /Workflow interrupted/);
  assert.doesNotMatch(source, /onClick=\{\(\) => run\(selected\)\}/);
});

test("custom workflow deletion is confirmed and built-ins cannot be deleted", () => {
  assert.match(source, /data-testid="macro-delete-confirm"/);
  assert.match(source, /if \(macro\.builtIn \|\| !confirmDelete\) return/);
  assert.match(source, /if \(!persist\(next\)\) return/);
  assert.match(source, /setConfirmDelete\(false\)/);
  assert.match(source, /Built-in workflows are unchanged/);
  assert.match(source, /selected\.builtIn &&/);
});

test("step editing is labelled, accessible, bounded to 24, with fixed symbol validation", () => {
  for (const label of ["Tool", "Symbol context", "Open as", "Fixed symbol", "Workflow name", "Description"]) {
    assert.ok(source.includes(label), "missing editor control: " + label);
  }
  assert.match(source, /editing\.steps\.length >= 24/);
  assert.match(source, /maxLength=\{80\}/);
  assert.match(source, /maxLength=\{240\}/);
  assert.match(source, /maxLength=\{32\}/);
  assert.match(source, /aria-label=\{"Move step " \+ \(index \+ 1\) \+ " earlier"\}/);
  assert.match(source, /aria-label=\{"Remove step " \+ \(index \+ 1\)\}/);
});

test("canonical macro copy and step resolution preserve built-ins, execution order and fixed/active symbol rules", () => {
  const builtIn = getBuiltInTerminalMacros()[0];
  assert.ok(builtIn.builtIn);
  const copy = duplicateTerminalMacro(builtIn);
  assert.equal(copy.builtIn, false);
  assert.notEqual(copy.id, builtIn.id);
  assert.equal(copy.steps.length, builtIn.steps.length);
  assert.equal(builtIn.builtIn, true);
  assert.deepEqual(resolveTerminalMacro(copy, " msft ").map((step) => step.view),
    resolveTerminalMacro(builtIn, "MSFT").map((step) => step.view));

  const step: TerminalMacroStep = { id: "one", view: "chart", symbolMode: "fixed", openMode: "split-right", fixedSymbol: " nvda " };
  const macro = createTerminalMacro({ name: "Research run", steps: [step] });
  assert.equal(validateTerminalMacro(macro).length, 0);
  assert.equal(resolveTerminalMacro(macro, "TSLA")[0].symbol, "NVDA");
  assert.equal(resolveTerminalMacro(macro, "TSLA")[0].openMode, "split-right");
  const noSymbol = { ...macro, steps: [{ ...step, fixedSymbol: " " }] };
  assert.ok(validateTerminalMacro(noSymbol).some((value) => value.includes("fixed symbol")));
});


test("global Workbench shortcuts yield Escape and other keys to the focused dialog", () => {
  const handlerIndex = overlaySource.indexOf("const handler = (event: KeyboardEvent)");
  const guardIndex = overlaySource.indexOf('target?.closest?.("[role=\'dialog\']")');
  const escapeIndex = overlaySource.indexOf('if (event.key === "Escape" && (surface || contextMenu || peek || inspector))');
  assert.ok(handlerIndex >= 0, "global listener exists");
  assert.ok(guardIndex > handlerIndex, "dialog guard belongs to listener");
  assert.ok(escapeIndex > guardIndex, "dialog guard must precede global Escape");
  assert.match(overlaySource, /window\.addEventListener\("keydown", handler, \{ capture: true \}\)/);
  assert.match(source, /onEscapeKeyDown=\{\(event\) => \{ if \(editing\) \{ event\.preventDefault\(\); requestClose\(\); \} \}\}/);
});


test("draft dismissal distinguishes cancelling an edit from closing the full manager", () => {
  assert.match(source, /const \[closeAfterDiscard, setCloseAfterDiscard\] = useState\(false\)/);
  assert.match(source, /setCloseAfterDiscard\(true\)/);
  assert.match(source, /setCloseAfterDiscard\(false\)/);
  assert.match(source, /if \(closeAfterDiscard\) onClose\(\)/);
  assert.match(source, /data-testid="macro-discard-confirm"/);
});
