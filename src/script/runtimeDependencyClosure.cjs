// Resolve installed npm lockfile placements, never package-name or dev-flag approximations.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PACKAGE_PATH = /^(?:node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/;
const PACKAGE_NAME = /^(?:@[^/]+\/)?[^/]+$/;
const LEGAL_NAME = /^(?:third[-_]?party[-_])?(?:licen[cs]es?|copying|notices?)(?:[._-].*)?$/i;
const ARCH_NAMES = ["ia32", "x64", "arm", "arm64"];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = (message) => { throw new Error(`[runtimeDependencyClosure] ${message}`); };
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const installedName = (location) => location.slice(location.lastIndexOf("node_modules/") + 13);

function declarations(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid dependency declarations");
  for (const [name, spec] of Object.entries(value)) {
    if (!PACKAGE_NAME.test(name) || name === "." || name === ".." || name.includes("\\") || typeof spec !== "string") {
      fail(`Invalid dependency declaration: ${name}`);
    }
  }
  return value;
}

function sameDeclarations(a, b) {
  return JSON.stringify(Object.entries(declarations(a)).sort(([a], [b]) => compare(a, b))) ===
    JSON.stringify(Object.entries(declarations(b)).sort(([a], [b]) => compare(a, b)));
}

function constraintMatches(constraint, target) {
  if (!constraint) return true;
  const values = Array.isArray(constraint) ? constraint : [constraint];
  if (values.some((value) => typeof value !== "string")) fail("Invalid target constraint");
  if (!target) return false;
  if (values.includes(`!${target}`)) return false;
  const positive = values.filter((value) => !value.startsWith("!"));
  return positive.length === 0 || positive.includes(target) || positive.includes("any");
}

function compatible(entry, target) {
  return constraintMatches(entry.os, target.platform) && constraintMatches(entry.cpu, target.arch) &&
    (target.platform !== "linux" || constraintMatches(entry.libc, target.libc));
}

function resolveLockPath(packages, from, name) {
  let current = from;
  while (true) {
    if (path.posix.basename(current) !== "node_modules") {
      const candidate = current ? `${current}/node_modules/${name}` : `node_modules/${name}`;
      if (Object.hasOwn(packages, candidate)) return candidate;
    }
    if (!current) return undefined;
    const parent = path.posix.dirname(current);
    current = parent === "." ? "" : parent;
  }
}

function assertPackageDirectory(moduleRoot, location) {
  const segments = location.split("/").slice(1);
  let directory = moduleRoot;
  for (const segment of segments) {
    directory = path.join(directory, segment);
    let stat;
    try { stat = fs.lstatSync(directory); } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
    if (stat.isSymbolicLink()) fail(`Unsupported linked package path: ${location}`);
    if (!stat.isDirectory()) fail(`Package path is not a directory: ${location}`);
  }
  return directory;
}

function selectRuntimeClosure({ projectDir, platform, arch, libc }) {
  const manifest = json(path.join(projectDir, "package.json"));
  const lock = json(path.join(projectDir, "package-lock.json"));
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || !lock.packages[""]) {
    fail("A package-lock v2/v3 with root package metadata is required");
  }
  for (const field of ["dependencies", "optionalDependencies", "devDependencies"]) {
    if (!sameDeclarations(manifest[field], lock.packages[""][field])) fail(`Manifest/lock ${field} drift`);
  }
  const target = { platform, arch: typeof arch === "number" ? ARCH_NAMES[arch] : arch, ...(libc ? { libc } : {}) };
  if (!target.platform || !target.arch || target.arch === "universal") fail("A concrete packaging target OS/architecture is required");
  const moduleRoot = fs.realpathSync(path.join(projectDir, "node_modules"));
  if (!fs.statSync(moduleRoot).isDirectory()) fail("Installed node_modules is not a directory");
  const selected = new Map();
  const omitted = new Map();
  const roots = [];
  function omit(from, name, reason) {
    const entry = { from, name, reason };
    omitted.set(JSON.stringify(entry), entry);
  }
  function visit(from, name, spec, optional) {
    const location = resolveLockPath(lock.packages, from, name);
    if (!location) {
      if (optional) return omit(from, name, "not-locked");
      fail(`Missing required locked edge: ${from || "<root>"} -> ${name}`);
    }
    if (!PACKAGE_PATH.test(location) || location.split("/").some((part) => part === "." || part === ".." || part.includes("\\"))) {
      fail(`Unsafe lock package path: ${location}`);
    }
    const entry = lock.packages[location];
    if (entry.link || !entry.version || typeof entry.version !== "string") fail(`Unsupported linked or unversioned lock package: ${location}`);
    if (!compatible(entry, target)) {
      if (optional) return omit(from, name, "incompatible-target");
      fail(`Required package is incompatible with target: ${location}`);
    }
    const directory = assertPackageDirectory(moduleRoot, location);
    if (!directory) {
      if (optional) return omit(from, name, "not-installed");
      fail(`Missing required installed edge: ${from || "<root>"} -> ${location}`);
    }
    const manifestPath = path.join(directory, "package.json");
    if (fs.lstatSync(manifestPath).isSymbolicLink()) fail(`Linked package metadata is refused: ${location}`);
    const actual = json(manifestPath);
    const alias = /^npm:((?:@[^/]+\/)?[^@]+)@/.exec(spec);
    const expectedName = entry.name || (alias && alias[1]) || installedName(location);
    if (actual.name !== expectedName || actual.version !== entry.version) fail(`Installed package identity/version drift: ${location}`);
    if (!compatible(actual, target)) fail(`Installed package target drift: ${location}`);
    if (selected.has(location)) return location;
    selected.set(location, { path: location, name: actual.name, version: actual.version, directory });
    // Placement and installed identity/version are authoritative for aliases and
    // npm overrides; raw requested semver ranges may intentionally not match.
    const dependencies = declarations(entry.dependencies);
    const optionals = declarations(entry.optionalDependencies);
    for (const dependency of Object.keys({ ...dependencies, ...optionals }).sort(compare)) {
      visit(location, dependency, optionals[dependency] ?? dependencies[dependency], Object.hasOwn(optionals, dependency));
    }
    for (const [peer, range] of Object.entries(declarations(entry.peerDependencies)).sort(([a], [b]) => compare(a, b))) {
      visit(location, peer, range, entry.peerDependenciesMeta?.[peer]?.optional === true);
    }
    return location;
  }
  const dependencies = declarations(manifest.dependencies);
  const optionals = declarations(manifest.optionalDependencies);
  for (const name of Object.keys({ ...dependencies, ...optionals }).sort(compare)) {
    const optional = Object.hasOwn(optionals, name);
    const location = visit("", name, optionals[name] ?? dependencies[name], optional);
    if (location) roots.push({ name, path: location, reason: optional ? "optionalDependency" : "dependency" });
  }
  const tsxSpec = dependencies.tsx ?? optionals.tsx ?? declarations(manifest.devDependencies).tsx;
  if (!tsxSpec) fail("Distributed TypeScript operator scripts require a declared tsx root");
  const tsxPath = visit("", "tsx", tsxSpec, false);
  if (!roots.some((root) => root.name === "tsx")) roots.push({ name: "tsx", path: tsxPath, reason: "typescript-operator" });
  return {
    target,
    roots: roots.sort((a, b) => compare(a.path, b.path)),
    packages: [...selected.values()].sort((a, b) => compare(a.path, b.path)),
    omittedOptionals: [...omitted.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  };
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function copyRuntimeClosure(closure, stagingDir) {
  const legalFiles = [];
  for (const pkg of closure.packages) {
    const sourceRoot = pkg.directory;
    function copy(source, destination, relative, ancestors, legal) {
      // Every package placement is copied independently. This also excludes
      // installed fixture trees deeper in test/assets directories, but never
      // prunes bytes beneath a legal directory.
      if (relative.split("/").includes("node_modules") && !legal) return;
      const stat = fs.lstatSync(source);
      const real = fs.realpathSync(source);
      if (!inside(sourceRoot, real) || (!legal && path.relative(sourceRoot, real).split(path.sep).includes("node_modules"))) {
        fail(`Escaping package symlink: ${pkg.path}/${relative}`);
      }
      const resolved = stat.isSymbolicLink() ? fs.statSync(real) : stat;
      if (resolved.isDirectory()) {
        if (ancestors.has(real)) fail(`Cyclic package symlink: ${pkg.path}/${relative}`);
        fs.mkdirSync(destination, { recursive: true });
        const next = new Set(ancestors).add(real);
        for (const child of fs.readdirSync(source).sort(compare)) {
          copy(path.join(source, child), path.join(destination, child), relative ? `${relative}/${child}` : child, next, legal || LEGAL_NAME.test(child));
        }
        fs.chmodSync(destination, resolved.mode & 0o777);
      } else if (resolved.isFile()) {
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE);
        fs.chmodSync(destination, resolved.mode & 0o777);
        if (legal) {
          const sha256 = digest(source);
          if (digest(destination) !== sha256) fail(`Copied dependency legal bytes changed: ${pkg.path}/${relative}`);
          legalFiles.push({ path: `${pkg.path}/${relative}`, sha256 });
        }
      } else {
        fail(`Unsupported package payload entry: ${pkg.path}/${relative}`);
      }
    }
    copy(sourceRoot, path.join(stagingDir, pkg.path), "", new Set(), false);
  }
  return legalFiles;
}

function closureEvidence(closure, limit = 24) {
  const packages = closure.packages.map(({ path, name, version }) => ({ path, name, version }));
  const selectionSha256 = crypto.createHash("sha256").update(JSON.stringify({ target: closure.target, roots: closure.roots, packages, omittedOptionals: closure.omittedOptionals })).digest("hex");
  return {
    target: closure.target, selectionSha256,
    selectedCount: packages.length, selectedPaths: packages.slice(0, limit),
    rootCount: closure.roots.length, roots: closure.roots.slice(0, limit),
    omittedOptionalCount: closure.omittedOptionals.length, omittedOptionals: closure.omittedOptionals.slice(0, limit),
    detailLimit: limit,
  };
}

module.exports = { selectRuntimeClosure, copyRuntimeClosure, closureEvidence };
