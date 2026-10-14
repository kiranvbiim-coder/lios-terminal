const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const WORKSPACE_VERSION = 1;

function workspacePaths(root) {
  return {
    root,
    metadata: path.join(root, "workspace.json"),
    connectors: path.join(root, "connectors"),
    datasets: path.join(root, "datasets"),
    exports: path.join(root, "exports"),
  };
}

function readMetadata(metadataPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (parsed && parsed.version === WORKSPACE_VERSION && typeof parsed.workspaceId === "string" && typeof parsed.createdAt === "string") return parsed;
  } catch {
    // A damaged or partial metadata file is replaced with a valid manifest.
  }
  return null;
}

function ensureLocalWorkspace(root) {
  const paths = workspacePaths(path.resolve(root));
  for (const directory of [paths.root, paths.connectors, paths.datasets, paths.exports]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const existing = readMetadata(paths.metadata);
  if (existing) return { ...existing, paths };
  const metadata = {
    version: WORKSPACE_VERSION,
    workspaceId: `ws_${crypto.randomUUID().replace(/-/g, "")}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    connectorDirectory: paths.connectors,
    datasetDirectory: paths.datasets,
    exportDirectory: paths.exports,
  };
  const temporary = `${paths.metadata}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, paths.metadata);
  return { ...metadata, paths };
}

module.exports = { WORKSPACE_VERSION, ensureLocalWorkspace, workspacePaths };
