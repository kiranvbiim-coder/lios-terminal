import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const canvas = read("../components/terminal/SpatialResearchCanvas.tsx");
const styles = read("../visual-intelligence-canvas.css");
const shell = read("../components/terminal/AnalyticalStudio.tsx");
const visualCanvas = read("../components/terminal/VisualCanvas.tsx");
const uxSettings = read("../components/terminal/TerminalUxSettings.tsx");

test("Phase 2 spatial research stays inside the existing Studio and opens the existing Workbench", () => {
  assert.match(shell, /<SpatialResearchCanvas onOpen=\{onOpen\}/);
  assert.match(canvas, /onOpen\(item\.view, "tab", item\.symbol \|\| undefined\)/);
  assert.match(canvas, /onOpen\(selected\.view, "tab", selected\.symbol \|\| undefined\)/);
  assert.doesNotMatch(canvas, /fetch\(|WebSocket|navigator\.geolocation|Math\.random\(/);
});

test("Phase 2 Map, Timeline and List require explicit user selection", () => {
  assert.match(canvas, /useState<SpatialLayoutMode>\("map"\)/);
  for (const mode of ["map", "timeline", "list"]) {
    assert.ok(canvas.includes(`aria-pressed={mode === "${mode}"}`));
  }
  assert.match(canvas, /aria-expanded=\{expanded\}/);
  assert.match(canvas, /role="group"/);
  assert.match(canvas, /aria-live="polite"/);
  assert.match(canvas, /hiddenCount/);
  assert.match(canvas, /aria-label="Filter research pins by kind"/);
  assert.match(canvas, /kindFilter === "all" \? items : items\.filter\(item => item\.kind === kindFilter\)/);
});

test("Phase 2 pointer movement previews locally and commits once, while keyboard movement stays available", () => {
  assert.match(canvas, /const \[dragPreview, setDragPreview\]/);
  assert.match(canvas, /if \(!commit\) \{/);
  assert.match(canvas, /move\(dragRef\.current\.kind, dragRef\.current\.id, point, false\)/);
  assert.match(canvas, /drag\?\.kind === "node" && preview\?\.id === drag\.id\) move/);
  assert.match(canvas, /event\.currentTarget\.setPointerCapture\(event\.pointerId\)/);
  assert.match(canvas, /onPointerCancel=\{cancelDrag\}/);
  assert.match(canvas, /const cancelDrag = \(event:/);
  assert.match(canvas, /Move canceled\. The prior saved pin position is unchanged/);
  assert.match(canvas, /onKeyDown=\{event => keyboardMove\(event, "node", item\.id\)\}/);
  assert.match(canvas, /removeResearchCanvasPosition\(item\.id\)/);
});

test("Phase 2 Insight companion is single, removable, movable and reads exact pinned object", () => {
  assert.match(canvas, /const \[inspectedId, setInspectedId\] = useState<string \| null>\(null\)/);
  assert.match(canvas, /model\.nodes\.find\(node => node\.item\.id === inspectedId\)/);
  assert.match(canvas, /aria-label="Insight companion"/);
  assert.match(canvas, /onPointerDown=\{event => startDrag\(event, "companion", selected\.id\)\}/);
  assert.match(canvas, /onKeyDown=\{event => keyboardMove\(event, "companion", selected\.id\)\}/);
  assert.match(canvas, /setInspectedId\(null\)/);
  assert.doesNotMatch(canvas, /createArtifact|runConversation/);
});

test("Phase 2 CSS never replaces global shell geometry and respects mobile and low-resource constraints", () => {
  assert.match(styles, /\.lios-spatial-board\[data-layout="list"\]/);
  assert.match(styles, /\.lios-spatial-research \{[^}]*container-type: inline-size/);
  assert.match(styles, /@container \(max-width: 760px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\[data-low-resource-mode="true"\] \.lios-spatial-field/);
  assert.match(styles, /\.lios-spatial-research button:focus-visible/);
  assert.doesNotMatch(styles, /\.lios-dockview-workspace\s*\{/);
});

test("Phase 2 visual-intensity preference is a safe presentation change on the sole visual canvas", () => {
  assert.match(visualCanvas, /resolveVisualIntensity\(/);
  assert.match(visualCanvas, /surface === "workbench"/);
  assert.match(uxSettings, /aria-label="Visual atmosphere intensity"/);
  assert.match(uxSettings, /"auto", "immersive", "contextual", "focus"/);
  assert.match(uxSettings, /update\(\{ visualIntensity \}\)/);
});


test("Phase 2 guided trails are explicitly named, user-started and source-only", () => {
  assert.match(canvas, /buildExplicitResearchTrails\(model\.nodes\)/);
  assert.match(canvas, /aria-label="Guided evidence trail"/);
  assert.match(canvas, /aria-label="Choose your saved research group"/);
  assert.match(canvas, /stepExplicitResearchTrail\(selectedTrail\.itemIds, inspectedId, direction\)/);
  assert.match(canvas, /onClick=\{\(\) => \{ if \(selectedTrail\) openInspection\(selectedTrail\.itemIds\[0\]\)/);
  assert.match(canvas, /aria-label="Previous pinned research item"/);
  assert.match(canvas, /aria-label="Next pinned research item"/);
  assert.match(canvas, /data-trail-member=/);
  assert.match(styles, /\.lios-spatial-board\[data-trail-active="true"\] \.lios-spatial-node\[data-trail-current="true"\]/);
});


test("Phase 2 provenance inspector opens only a chosen visible graph connection, never a fabricated claim", () => {
  assert.match(canvas, /listExplicitResearchConnections\(model\)/);
  assert.match(canvas, /inspectExplicitResearchConnection\(model, selectedConnectionKey\)/);
  assert.match(canvas, /useState<string \| null>\(null\)/);
  assert.match(canvas, /aria-label="Visible user-grouped connections"/);
  assert.match(canvas, /aria-label="Selected connection provenance"/);
  assert.match(canvas, /aria-pressed=\{inspectedConnection\?\.key === connection\.key\}/);
  assert.match(canvas, /onClick=\{\(\) => setSelectedConnectionKey\(connection\.key\)\}/);
  assert.match(canvas, /if \(selectedConnectionKey && !inspectedConnection\) setSelectedConnectionKey\(null\)/);
  assert.match(canvas, /This line represents group membership only/);
  assert.match(canvas, /has not verified any link/);
  assert.match(canvas, /onClick=\{\(\) => openInspection\(inspectedConnection\.from\.id\)\}/);
  assert.match(canvas, /onClick=\{\(\) => openInspection\(inspectedConnection\.to\.id\)\}/);
  assert.match(canvas, /data-connection-current=/);
  assert.match(canvas, /data-connection-member=/);
  assert.match(styles, /\.lios-spatial-connections-summary/);
  assert.match(styles, /\.lios-spatial-node\[data-connection-member="true"\]/);
  assert.match(styles, /@container \(max-width: 540px\)/);
});
