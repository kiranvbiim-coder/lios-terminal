import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (p) => readFileSync(resolve(root, p), "utf8");
const share = source("client/src/components/terminal/WorkspaceSharePreview.tsx");
const workspace = source("client/src/lib/terminalWorkspace.ts");
const pane = source("client/src/components/terminal/ArtifactPane.tsx");
const guard = source("client/src/lib/artifactExportDisclosure.ts");
const server = source("server/artifactRoutes.ts");
const exportPlan = source("server/artifactExport.ts");
const sharedRights = source("shared/artifactExportRights.ts");

test("WS-63 no private Artifact/tenant identifiers leave the public share URL", () => {
  assert.match(workspace, /workspaceForShare\(workspace\)/);
  assert.match(workspace, /url\.searchParams\.set\("ws", serializeWorkspace\(workspaceForShare\(workspace\)\)\)/);
  assert.match(workspace, /url\.pathname = "\/"/);
  assert.match(workspace, /url\.username = ""/);
  assert.match(workspace, /url\.password = ""/);
  assert.match(workspace, /return decoded \? workspaceForShare\(decoded\) : null/);
  assert.match(workspace, /raw\.length > 10_000/);
  assert.match(share, /getWorkspacePanes\(workspaceForShare\(workspace\)\)/);
  assert.match(share, /data-testid="share-public-symbol-consent"/);
  assert.match(share, /!disclosureConfirmed/);
});

test("WS-63 Artifact export requires specific owner request and explicit rights review", () => {
  assert.match(server, /app\.use\(prefix, requireAuth\)/);
  assert.match(server, /getArtifactExportPlan\(ctx\(req\), pathText\(req\.params\.artifactId\), version\)/);
  assert.match(pane, /const exportRights = artifactExportDisclosure\(/);
  assert.match(pane, /if \(exportRights\.blocked\)/);
  assert.match(pane, /if \(!exportAcknowledged\)/);
  assert.match(pane, /data-testid="artifact-export-consent"/);
  assert.match(pane, /exportRights\.blocked \|\| !exportAcknowledged/);
  assert.match(pane, /const plan = await getArtifactExportPlan\(revision\.artifactId, revision\.version\)/);
  assert.match(pane, /assertCurrentRevision\(\)/);
  assert.match(guard, /recordedBlockedArtifactSources\(manifest\)/);
  assert.match(sharedRights, /denied\.test\(item\.access\.state/);
  assert.match(exportPlan, /recordedBlockedArtifactSources\(manifest\?\.success \? manifest\.data : null\)/);
  assert.match(exportPlan, /throw new ArtifactExportRightsError\(/);
  assert.match(server, /error instanceof ArtifactExportRightsError/);
  assert.match(server, /res\.status\(error\.status\)/);
});
