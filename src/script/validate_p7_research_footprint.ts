import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const requirements=fs.readFileSync(path.join(root,"python-service/requirements.txt"),"utf8").toLowerCase();
const manifest=fs.readFileSync(path.join(root,"server/runtimeManifest.ts"),"utf8");
const terminalTypes=fs.readFileSync(path.join(root,"client/src/lib/terminalTypes.ts"),"utf8");
const docling=fs.readFileSync(path.join(root,"server/p7DocumentIntelligence.ts"),"utf8");
const thirdParty=JSON.parse(fs.readFileSync(path.join(root,"../third_party/components.json"),"utf8"));
const components=Array.isArray(thirdParty)?thirdParty:thirdParty.components;

assert.equal(Boolean(pkg.dependencies?.docling||pkg.dependencies?.["sqlite-vec"]),false,"P7 document/vector engines must not bloat Node Core.");
assert.equal(requirements.includes("docling==")||requirements.includes("docling-slim"),false,"P7 Docling must remain an opt-in managed pack, not base Python CI runtime.");
assert.ok(manifest.includes('id: "research-docs"')&&manifest.includes("ciSuperset: false"),"P7 research-docs optional pack posture missing.");
assert.ok(docling.includes("managedRuntimePythonPath")&&docling.includes("assertLocalByodRuntime")&&!docling.includes("shell: true"),"P7 Docling adapter must stay local/governed and shell-free.");
assert.equal(terminalTypes.includes('"projectintelligence"'),false,"P7 must not create a permanent Project Intelligence top-level navigation module.");
assert.equal(terminalTypes.includes('"researchgraph"'),false,"P7 must not create a permanent Research Graph top-level navigation module.");
const sqlite=components.find((item:any)=>item.id==="sqlite-vec");
assert.ok(sqlite&&sqlite.bundled===false&&sqlite.classification==="stub","P7 sqlite-vec must remain optional/non-authoritative until scale justifies activation.");
const d=components.find((item:any)=>item.id==="docling");
assert.ok(d&&d.classification!=="stub"&&(d.bundled===false||(Array.isArray(d.destinationPaths)&&d.destinationPaths.length>0&&d.destinationPaths.every((p:string)=>p.startsWith("src/sandbox-image/")))),"P7 Docling must remain optional outside the SP-01 sandbox image.");
console.log("P7 research footprint guard: PASS");
