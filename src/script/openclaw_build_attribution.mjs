// Build-only inspection of the approved donor. No source text, credentials or runtime bytes are emitted.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function withModuleAttribution(config, index) {
  const existing = config.plugins ? (Array.isArray(config.plugins) ? config.plugins : [config.plugins]) : [];
  return {
    ...config,
    plugins: [...existing, {
      name: "lios-approved-source-module-attribution",
      generateBundle(options, bundle) {
        const cwd = process.cwd();
        const relative = value => path.relative(cwd, value).split(path.sep).join("/");
        const graph = {
          configIndex: index,
          outputDirectory: relative(path.resolve(options.dir || path.dirname(options.file || "dist/entry.js"))),
          chunks: Object.values(bundle).filter(item => item.type === "chunk").map(chunk => ({
            fileName: chunk.fileName,
            isEntry: chunk.isEntry,
            modules: Object.keys(chunk.modules).map(id => id.startsWith(cwd + path.sep) ? relative(id) : id).sort(),
            imports: [...chunk.imports].sort(),
            dynamicImports: [...chunk.dynamicImports].sort(),
          })).sort((a, b) => a.fileName.localeCompare(b.fileName)),
          assets: Object.values(bundle).filter(item => item.type === "asset").map(item => item.fileName).sort(),
        };
        const body = JSON.stringify(graph);
        const id = createHash("sha256").update(body).digest("hex");
        const directory = path.join(cwd, ".artifacts", "lios-module-attribution");
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, `${index}-${id}.json`), body);
      },
    }],
  };
}

/** Select actual root-pack chunks, not the entire development dist tree. Not a license verdict. */
export function inspectRootPackClosure(pack, graphs) {
  if (!pack || !Array.isArray(pack.files) || !pack.files.length) throw new Error("Root pack file inventory is unavailable");
  const files = new Set(pack.files.map(file => {
    if (!file || typeof file.path !== "string" || path.posix.isAbsolute(file.path) || file.path.split("/").some(part => part === "..")) {
      throw new Error("Invalid root-pack path");
    }
    return file.path;
  }));
  const forbiddenFiles = [...files].filter(file => /^dist\/extensions\/(?:whatsapp|acpx|qa-lab)(?:\/|$)/.test(file));
  if (forbiddenFiles.length) throw new Error("Root pack admitted explicitly excluded optional plugin files");
  const modules = new Set();
  const attributedChunks = new Set();
  for (const graph of graphs) {
    for (const chunk of graph.chunks) {
      const filename = path.posix.join(graph.outputDirectory, chunk.fileName);
      if (!files.has(filename)) continue;
      attributedChunks.add(filename);
      chunk.modules.forEach(id => modules.add(id));
    }
  }
  if (!attributedChunks.size || !modules.size) throw new Error("Emitted root-pack module attribution is unavailable");
  const knownRestrictedCandidates = [...modules].filter(id => /(?:^|\/)(?:libsignal|baileys|crabline|decode-aac|decode-ac3|decode-dts|decode-eac3|decode-wma|codec-parser|claude-agent-sdk|claude-agent-acp)(?:@|\/|$)/i.test(id)).sort();
  const rootPackPaths = [...files].sort();
  const moduleIdentifiers = [...modules].sort();
  return {
    rootPackFileCount: files.size,
    rootPackFileInventorySha256: createHash("sha256").update(JSON.stringify(rootPackPaths)).digest("hex"),
    attributedRootChunks: attributedChunks.size,
    attributedRootModules: modules.size,
    attributedModuleInventorySha256: createHash("sha256").update(JSON.stringify(moduleIdentifiers)).digest("hex"),
    knownRestrictedModuleCandidates: knownRestrictedCandidates,
    excludedOptionalPluginFilesPresent: false,
    scope: "Root-config emitted modules only; dynamic runtime loads, nested bundlers, native assets, dependencies and license texts need separate review",
    distributionCleared: false,
    rootPackPaths,
    moduleIdentifiers,
  };
}
