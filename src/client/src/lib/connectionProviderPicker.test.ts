import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chooseConnectionProviders,
  connectionPickerStatus,
  returnFromConnectionCenter,
} from "./connectionProviderPicker";

const catalog = [
  { id: "fred", name: "FRED", description: "Macro data", category: "macro", adapterImplemented: true },
  { id: "simfin", name: "SimFin", description: "Company fundamentals", category: "fundamentals" },
  { id: "future", name: "Future Broker", description: "Execution research only", category: "trading", adapterImplemented: false },
] as const;

test("provider picker searches a local immutable catalog independently of the main catalog filters", () => {
  assert.deepEqual(chooseConnectionProviders(catalog, "  macro "), [catalog[0]]);
  assert.deepEqual(chooseConnectionProviders(catalog, "Fundamental"), [catalog[1]]);
  assert.deepEqual(chooseConnectionProviders(catalog, "future"), [catalog[2]]);
  assert.equal(chooseConnectionProviders(catalog, "nonexistent").length, 0);
  assert.deepEqual(chooseConnectionProviders(catalog, ""), catalog);
  assert.equal(catalog[0].name, "FRED", "search does not rewrite canonical options");
});

test("catalog-only is never connectable; saved configuration does not imply a verified live source", () => {
  assert.deepEqual(connectionPickerStatus(catalog[2], false), {
    canSelect: false, label: "Catalog only · adapter unavailable",
  });
  assert.deepEqual(connectionPickerStatus(catalog[2], true), {
    canSelect: false, label: "Catalog only · adapter unavailable",
  });
  assert.deepEqual(connectionPickerStatus(catalog[1], true), {
    canSelect: true, label: "Saved configuration · review verification separately",
  });
  assert.deepEqual(connectionPickerStatus(catalog[0], false), {
    canSelect: true, label: "Available to configure · not yet connected",
  });
});

test("return to mounted work calls only the supplied navigation closure, never a setup request", () => {
  const observed: string[] = [];
  returnFromConnectionCenter(() => observed.push("workspace restored"));
  assert.deepEqual(observed, ["workspace restored"]);
});

test("Connection Center uses existing accessible Radix dialog and separate provider picker, not a second dialog implementation", () => {
  const code = readFileSync(new URL("../pages/DataConnectionCenter.tsx", import.meta.url), "utf8");
  assert.match(code, /<Dialog open onOpenChange=/);
  assert.match(code, /<DialogTitle/);
  assert.match(code, /onCloseAutoFocus=\{event =>/);
  assert.match(code, /const \[providerPickerQuery, setProviderPickerQuery\] = useState\(" "\.trim\(\)\)/);
  assert.match(code, /const pickerProviders = useMemo\(\(\) => chooseConnectionProviders\(catalogConnectors, providerPickerQuery\)/);
  assert.match(code, /aria-label="Search providers"/);
  assert.match(code, /value=\{providerPickerQuery\}/);
  assert.match(code, /data-testid="connection-provider-chooser"/);
  assert.match(code, /disabled=\{!connectionPickerStatus\(c, configuredProviderIds\.has\(c\.id\)\)\.canSelect\}/);
  assert.match(code, /Saved configuration · review verification separately|connectionPickerStatus\(c, configuredProviderIds\.has\(c\.id\)\)\.label/);
  assert.match(code, /pickerProviders\.length === 0/);
  assert.match(code, /onClose=\{\(\) => \{ if \(!saving && !testing\) onClose\(\); \}\}/, "cannot dismiss a provider during a credential write");
});

test("return is a separate, nonmutating workflow, and App retains Chat/Workbench plus original focus", () => {
  const code = readFileSync(new URL("../pages/DataConnectionCenter.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(code, /const handleReturnToWork = \(\) => returnFromConnectionCenter\(onComplete\)/);
  assert.match(code, /data-testid="connection-return-to-work"/);
  assert.match(code, /data-testid="connection-return-to-work-footer"/);
  assert.match(code, /disabled=\{saving \|\| aiBusy \|\| masterBusy \|\| runtimeBusy !== null\}/);
  assert.match(code, /await persistSetup\(true, continueWithoutAi\)/, "explicit save-and-continue still exists");
  const returnSlice = code.slice(code.indexOf("const handleReturnToWork"), code.indexOf("async function handleEnterTerminal"));
  assert.doesNotMatch(returnSlice, /persistSetup|apiRequest|turnMasterAiOff/);
  assert.match(app, /<div data-lios-workspace hidden=\{environmentSetupOpen \|\| domainPickerOpen\}>/);
  assert.match(app, /environmentReturnFocus\.current = active instanceof HTMLElement/);
  assert.match(app, /environmentReturnFocus\.current = null/);
  assert.match(app, /opener\.focus\(\)/);
  assert.match(app, /onOpenEnvironment=\{openEnvironmentSetup\}/);
});
