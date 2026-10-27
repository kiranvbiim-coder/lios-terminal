import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const canvas = read("../components/terminal/SpatialResearchCanvas.tsx");
const styles = read("../visual-intelligence-canvas.css");
const shell = read("../components/terminal/AnalyticalStudio.tsx");
const motionPolicy = read("./spatialMotionPolicy.ts");
const presentationPolicy = read("./spatialPresentationPolicy.ts");
const overlays = read("../components/terminal/TerminalUxOverlays.tsx");
const visualCanvas = read("../components/terminal/VisualCanvas.tsx");
const uxSettings = read("../components/terminal/TerminalUxSettings.tsx");

test("Phase 2 spatial research stays inside the existing Studio and opens the existing Workbench", () => {
  assert.match(shell, /<SpatialResearchCanvas preferences=\{preferences\} initialReturnState=\{spatialCanvasReturn\}/);
  assert.match(canvas, /onOpen\(item\.view, "tab", item\.symbol \|\| undefined\)/);
  assert.match(canvas, /onOpen\(selected\.view, "tab", selected\.symbol \|\| undefined\)/);
  assert.doesNotMatch(canvas, /fetch\(|WebSocket|navigator\.geolocation|Math\.random\(/);
});

test("Phase 2 Map, Timeline and List require explicit user selection", () => {
  assert.match(canvas, /useState<SpatialLayoutMode>\(initialReturnState\?\.mode \?\? "map"\)/);
  for (const mode of ["map", "timeline", "list"]) {
    assert.ok(canvas.includes(`aria-pressed={mode === "${mode}"}`));
  }
  assert.match(canvas, /aria-expanded=\{expanded\}/);
  assert.match(canvas, /role="group"/);
  assert.match(canvas, /aria-live="polite"/);
  assert.match(canvas, /hiddenCount/);
  assert.match(canvas, /aria-label="Filter research pins by kind"/);
  assert.match(canvas, /const kindItems = useMemo\(\(\) => kindFilter === "all" \? items : items\.filter\(item => item\.kind === kindFilter\)/);
});

test("Phase 2 pointer movement previews locally and commits once, while keyboard movement stays available", () => {
  assert.match(canvas, /const \[dragPreview, setDragPreview\]/);
  assert.match(canvas, /if \(!commit\) \{/);
  assert.match(canvas, /move\(dragRef\.current\.kind, dragRef\.current\.id, point, false\)/);
  assert.match(canvas, /drag\?\.kind === "node" && preview\?\.id === drag\.id\) move/);
  assert.match(canvas, /event\.currentTarget\.setPointerCapture\(event\.pointerId\)/);
  assert.match(canvas, /onPointerCancel=\{cancelDrag\}/);
  assert.match(canvas, /const cancelDrag = \(event:/);
  assert.match(canvas, /Move canceled\. The previous position is unchanged/);
  assert.match(canvas, /canceled\?\.kind === "companion" && canceled\.startPoint/);
  assert.match(canvas, /onKeyDown=\{event => keyboardMove\(event, "node", item\.id\)\}/);
  assert.match(canvas, /removeResearchCanvasPosition\(item\.id\)/);
});

test("Phase 2 Insight companion is single, removable, movable and reads exact pinned object", () => {
  assert.match(canvas, /const \[inspectedId, setInspectedId\] = useState<string \| null>\(initialReturnState\?\.inspectedId \?\? null\)/);
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
  assert.match(canvas, /useState<string \| null>\(initialReturnState\?\.selectedConnectionKey \?\? null\)/);
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

test("Phase 2 Studio to Workbench to Studio restores only on-mount presentation", () => {
  assert.match(overlays, /const \[studioTab, setStudioTab\] = useState<SpatialStudioTab>\(INITIAL_SPATIAL_STUDIO_TAB\)/);
  assert.match(overlays, /const \[spatialCanvasReturn, setSpatialCanvasReturn\] = useState<SpatialCanvasReturnState>\(INITIAL_SPATIAL_CANVAS_RETURN_STATE\)/);
  assert.match(overlays, /selectedTab=\{studioTab\} onSelectTab=\{setStudioTab\}/);
  assert.match(overlays, /spatialCanvasReturn=\{spatialCanvasReturn\} onSpatialCanvasReturn=\{setSpatialCanvasReturn\}/);
  assert.match(shell, /<StudioNav tab=\{tab\} onTab=\{onSelectTab\}/);
  assert.match(shell, /onOpen=\{\(view, mode, symbol\) => \{ onOpen\(view, mode, symbol\); onClose\(\); \}\}/);
  assert.match(canvas, /reconcileSpatialCanvasReturnState\(/);
  assert.match(canvas, /connections\.map\(connection => connection\.key\)/);
  assert.match(canvas, /selectedConnectionKey, expanded/);
  assert.match(canvas, /onReturnStateChange\(/);
  assert.doesNotMatch(overlays, /localStorage\.setItem\(["']lios\.spatial/i);
});

test("Phase 2 Studio uses the shared focus-trapped dialog and returns keyboard focus safely", () => {
  assert.match(shell, /<Dialog open onOpenChange=\{open => \{ if \(!open\) onClose\(\); \}\}>/);
  assert.match(shell, /<DialogContent/);
  assert.match(shell, /<DialogTitle/);
  assert.match(shell, /<DialogDescription/);
  assert.match(shell, /onCloseAutoFocus=\{event => \{ event.preventDefault\(\); if \(opener\?\.isConnected\) opener.focus\(\); \}\}/);
  assert.doesNotMatch(shell, /onMouseDown=\{onClose\}/);
  assert.match(shell, /preferences.reducedMotion \|\| preferences.lowResourceMode/);
});

test("Phase 2 depth obeys user opt-in, software renderer, low-resource and reduced motion budgets", () => {
  assert.match(canvas, /resolveSpatialMotionBudget\(\{ \.\.\.preferences, softwareRendered: isSoftwareRendered\(\) \}\)/);
  assert.match(canvas, /data-motion-budget=/);
  assert.match(motionPolicy, /input.reducedMotion \|\| input.lowResourceMode \|\| input.softwareRendered/);
  assert.match(styles, /\.lios-spatial-research\[data-motion-budget="still"\] \.lios-spatial-board/);
  assert.match(styles, /\.lios-spatial-research\[data-motion-budget="subtle"\] \.lios-spatial-node:hover/);
  assert.match(styles, /prefers-reduced-motion: no-preference/);
});


test("Phase 2 Spotlight only searches local saved pins before graph truncation", () => {
  assert.ok(canvas.includes('const [searchQuery, setSearchQuery] = useState("");'));
  assert.match(canvas, /findSpatialResearchPins\(kindItems, searchQuery\)/);
  assert.match(canvas, /buildSpatialResearchModel\(visibleItems, positions, mode\)/);
  assert.match(canvas, /searchQuery\.trim\(\) \? visibleItems\.slice\(0, 5\) : \[\]/);
  assert.match(canvas, /role="search" aria-label="Find in pinned research"/);
  assert.match(canvas, /type="search" id="lios-spatial-find"/);
  assert.match(canvas, /maxLength=\{80\} autoComplete="off"/);
  assert.match(canvas, /if \(event\.key === "Enter" && visibleItems\.length\)/);
  assert.match(canvas, /event\.key === "Escape" && searchQuery/);
  assert.match(canvas, /onClick=\{\(\) => openInspection\(item\.id\)\}/);
  assert.match(canvas, /No matching pinned research/);
  assert.match(styles, /\.lios-spatial-spotlight-controls/);
  assert.match(styles, /\.lios-spatial-quick-hit:focus-visible/);
  assert.doesNotMatch(canvas, /fetch\(|createArtifact|runConversation|localStorage\.setItem/);
});

test("Phase 2 narrow and zoomed panes are readable, undraggable and never allocate decorative SVG", () => {
  assert.match(canvas, /const \[contentWidth, setContentWidth\] = useState<number \| null>\(null\)/);
  assert.match(canvas, /new ResizeObserver\(measure\)/);
  assert.match(canvas, /return \(\) => observer\.disconnect\(\)/);
  assert.match(canvas, /resolveSpatialPresentation\(mode, contentWidth\)/);
  assert.match(canvas, /if \(presentation\.stacked\) return/);
  assert.match(canvas, /presentation\.showDecorativeEdges && model\.edges\.length > 0/);
  assert.match(canvas, /presentation\.canMoveNodes && <button/);
  assert.match(canvas, /presentation\.canMoveCompanion \? <button/);
  assert.match(canvas, /<span className="lios-spatial-companion-grip">Insight companion<\/span>/);
  assert.match(canvas, /companionRegion\.current\?\.focus\(\)/);
  assert.match(canvas, /announcement \|\| presentation\.layoutHint/);
  assert.match(presentationPolicy, /SPATIAL_STACKED_MAX_WIDTH = 760/);
  assert.match(presentationPolicy, /canMoveNodes: mode === "map" && !stacked/);
  assert.match(presentationPolicy, /showDecorativeEdges: !stacked && mode !== "list"/);
});
