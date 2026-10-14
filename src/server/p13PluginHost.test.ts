import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import {
  authorizeBrokeredFilePath,
  authorizeBrokeredNetworkRequest,
  buildNodePluginLaunchPlan,
} from "./p13PluginHost";

function manifest(
  entrypoint = "dist/index.mjs",
  includeProcessSpawn = false,
  includeFilesystem = true,
) {
  return liosPluginManifestV1Schema.parse({
    apiVersion: "1",
    id: "com.example.host",
    name: "Host Test",
    version: "1.0.0",
    publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "node_process", entrypoint },
    dependencies: [],
    permissions: [
      "network.http",
      ...(includeFilesystem ? [
        "filesystem.project.read",
        "filesystem.project.write",
        "filesystem.user_selected.read",
      ] : []),
      ...(includeProcessSpawn ? ["process.spawn"] : []),
    ],
    connectors: [],
    tools: [],
    artifacts: [],
    agents: [],
    integrity: null,
    signer: null,
  });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-host-"));
  const installDirectory = path.join(root, "plugin");
  const dist = path.join(installDirectory, "dist");
  const projectRoot = path.join(root, "project");
  const userReadRoot = path.join(root, "user-read");
  const outsideRoot = path.join(root, "outside");
  fs.mkdirSync(dist, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(userReadRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.mjs"), "process.stdin.resume();\n");
  fs.writeFileSync(path.join(projectRoot, "input.csv"), "x\n1\n");
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "do-not-read\n");
  return {
    root,
    installDirectory,
    projectRoot,
    userReadRoot,
    outsideRoot,
    grant: {
      projectRoot,
      userSelectedReadRoots: [userReadRoot],
      userSelectedWriteRoots: [],
      networkHosts: ["api.example.com"],
      allowProcessSpawn: false,
    },
  };
}

test("P13 node host uses the Node permission model, sanitized env and no raw network access", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const previous = process.env.LIOS_P13_TEST_SECRET;
  process.env.LIOS_P13_TEST_SECRET = "must-not-leak";
  t.after(() => {
    if (previous === undefined) delete process.env.LIOS_P13_TEST_SECRET;
    else process.env.LIOS_P13_TEST_SECRET = previous;
  });

  const plan = buildNodePluginLaunchPlan({
    manifest: manifest("dist/index.mjs", false, false),
    installDirectory: f.installDirectory,
    trustState: "trusted",
    grant: {
      ...f.grant,
      projectRoot: null,
      userSelectedReadRoots: [],
      userSelectedWriteRoots: [],
    },
  });

  assert.ok(["--permission", "--experimental-permission"].includes(plan.args[0] ?? ""));
  if (process.versions.node.startsWith("22.12.")) assert.equal(plan.args[0], "--experimental-permission");
  const fsReadFlags = plan.args.filter((arg) => arg.startsWith("--allow-fs-read="));
  assert.equal(fsReadFlags.length, 1);
  assert.equal(fsReadFlags[0], "--allow-fs-read=" + fs.realpathSync.native(f.installDirectory));
  assert.equal(plan.args.some((arg) => arg.startsWith("--allow-fs-write=")), false);
  assert.ok(plan.args.some((arg) => arg.startsWith("--import=data:text/javascript,")));
  assert.equal(plan.args.includes("--allow-child-process"), false);
  assert.equal(plan.args.some((arg) => arg.startsWith("--allow-net")), false);
  assert.equal(plan.env.LIOS_PLUGIN_RAW_NETWORK, "denied");
  assert.equal(plan.env.LIOS_PLUGIN_PROCESS_SPAWN, "denied");
  assert.equal(plan.env.LIOS_P13_TEST_SECRET, undefined);
  assert.ok(plan.args.at(-1)?.endsWith(path.join("dist", "index.mjs")));
});

test("P13 executable host fails closed for direct Project/user filesystem permissions until brokered transport exists", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  assert.throws(
    () => buildNodePluginLaunchPlan({
      manifest: manifest(),
      installDirectory: f.installDirectory,
      trustState: "trusted",
      grant: f.grant,
    }),
    /brokered write-return lifecycle/i,
  );
});

test("P13 trusted read-only node launch requires current host authority without mounting Project roots", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const readManifest = liosPluginManifestV1Schema.parse({
    ...manifest("dist/index.mjs", false, false),
    permissions: ["filesystem.project.read", "filesystem.user_selected.read"],
  });
  assert.throws(() => buildNodePluginLaunchPlan({
    manifest: readManifest, installDirectory: f.installDirectory, trustState: "trusted", grant: f.grant,
  }), /server-owned read scope authorizer/i);
  const plan = buildNodePluginLaunchPlan({
    manifest: readManifest, installDirectory: f.installDirectory, trustState: "trusted", grant: f.grant,
    authorizeFileRead: ({ context, root, scope }) =>
      context.userId === 7 && context.organizationId === 3 && context.projectId === 41
      && scope === "project" && root === f.projectRoot,
  });
  assert.equal(plan.env.LIOS_PLUGIN_FILESYSTEM_BROKER, "read-only");
  assert.deepEqual(
    plan.args.filter((arg) => arg.startsWith("--allow-fs-read=")),
    ["--allow-fs-read=" + fs.realpathSync.native(f.installDirectory)],
  );
  assert.equal(plan.args.some((arg) => arg.startsWith("--allow-fs-write=")), false);
  for (const root of [f.projectRoot, f.userReadRoot]) {
    assert.equal(plan.args.some((arg) => arg.includes(root)), false);
    assert.equal(Object.values(plan.env).some((value) => value.includes(root)), false);
  }
  assert.throws(() => buildNodePluginLaunchPlan({
    manifest: readManifest, installDirectory: f.installDirectory, trustState: "unsigned", grant: f.grant,
    authorizeFileRead: () => true,
  }), /trusted signature/i);
});

test("P13 broker enforces exact network and real filesystem grants", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  assert.equal(
    authorizeBrokeredNetworkRequest("https://api.example.com/v1/data", manifest(), f.grant).hostname,
    "api.example.com",
  );
  assert.throws(
    () => authorizeBrokeredNetworkRequest("https://other.example.com/data", manifest(), f.grant),
    /outside the explicit allowlist/,
  );

  assert.equal(
    authorizeBrokeredFilePath(path.join(f.projectRoot, "input.csv"), "read", manifest(), f.grant),
    fs.realpathSync.native(path.join(f.projectRoot, "input.csv")),
  );
  assert.throws(
    () => authorizeBrokeredFilePath(path.join(f.outsideRoot, "secret.txt"), "read", manifest(), f.grant),
    /outside granted roots/,
  );

  const linkPath = path.join(f.projectRoot, "escape");
  fs.symlinkSync(f.outsideRoot, linkPath, "dir");
  assert.throws(
    () => authorizeBrokeredFilePath(path.join(linkPath, "secret.txt"), "read", manifest(), f.grant),
    /outside granted roots/,
  );
});

test("P13 install tree rejects symlinks before granting plugin-code read access", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const external = path.join(f.outsideRoot, "external.txt");
  fs.writeFileSync(external, "outside\n");
  fs.symlinkSync(external, path.join(f.installDirectory, "dist", "linked-data.txt"), "file");

  assert.throws(
    () => buildNodePluginLaunchPlan({
      manifest: manifest("dist/index.mjs", false, false),
      installDirectory: f.installDirectory,
      trustState: "trusted",
      grant: {
        ...f.grant,
        projectRoot: null,
        userSelectedReadRoots: [],
        userSelectedWriteRoots: [],
      },
    }),
    /install tree.*symbolic link/i,
  );
});

test("P13 entrypoint symlinks cannot escape the plugin install directory", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const externalEntrypoint = path.join(f.outsideRoot, "external.mjs");
  fs.writeFileSync(externalEntrypoint, "process.stdin.resume();\n");
  const symlinkEntrypoint = path.join(f.installDirectory, "dist", "escape.mjs");
  fs.symlinkSync(externalEntrypoint, symlinkEntrypoint, "file");

  assert.throws(
    () => buildNodePluginLaunchPlan({
      manifest: manifest("dist/escape.mjs", false, false),
      installDirectory: f.installDirectory,
      trustState: "trusted",
      grant: {
        ...f.grant,
        projectRoot: null,
        userSelectedReadRoots: [],
        userSelectedWriteRoots: [],
      },
    }),
    /(symlink resolves outside|install tree.*symbolic link)/i,
  );
});

test("P13 executable host refuses unsigned privileged plugin execution", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  assert.throws(
    () => buildNodePluginLaunchPlan({
      manifest: manifest(),
      installDirectory: f.installDirectory,
      trustState: "unsigned",
      grant: f.grant,
    }),
    /trusted signature/,
  );
});

test("P13 node host rejects direct child-process capability so it cannot bypass network isolation", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  assert.throws(
    () => buildNodePluginLaunchPlan({
      manifest: manifest("dist/index.mjs", true, false),
      installDirectory: f.installDirectory,
      trustState: "trusted",
      grant: {
        ...f.grant,
        projectRoot: null,
        userSelectedReadRoots: [],
        userSelectedWriteRoots: [],
        allowProcessSpawn: true,
      },
    }),
    /Direct process spawning is not permitted/,
  );
});

test("P13 broker rejects dangling symlink write escapes before a missing outside file exists", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const outsideNotYetCreated = path.join(f.outsideRoot, "future-secret.txt");
  const link = path.join(f.projectRoot, "new-report.txt");
  fs.symlinkSync(outsideNotYetCreated, link, "file");
  assert.equal(fs.existsSync(link), false, "Precondition: dangling final link is invisible to existsSync");
  assert.throws(
    () => authorizeBrokeredFilePath(link, "write", manifest(), f.grant),
    /symbolic-link file targets/i,
  );
  assert.equal(fs.existsSync(outsideNotYetCreated), false);
});

test("P13 broker permits ordinary file targets but refuses final symlinks and directories", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const existing = path.join(f.projectRoot, "input.csv");
  const future = path.join(f.projectRoot, "safe-new-output.csv");
  assert.equal(authorizeBrokeredFilePath(existing, "read", manifest(), f.grant), fs.realpathSync.native(existing));
  assert.equal(authorizeBrokeredFilePath(existing, "write", manifest(), f.grant), fs.realpathSync.native(existing));
  assert.equal(authorizeBrokeredFilePath(future, "write", manifest(), f.grant), path.join(fs.realpathSync.native(f.projectRoot), "safe-new-output.csv"));
  assert.throws(() => authorizeBrokeredFilePath(future, "read", manifest(), f.grant), /ENOENT/);
  const insideLink = path.join(f.projectRoot, "linked-input.csv");
  fs.symlinkSync(existing, insideLink, "file");
  assert.throws(() => authorizeBrokeredFilePath(insideLink, "read", manifest(), f.grant), /symbolic-link file targets/i);
  assert.throws(() => authorizeBrokeredFilePath(insideLink, "write", manifest(), f.grant), /symbolic-link file targets/i);
  for (const mode of ["read", "write"] as const) {
    assert.throws(() => authorizeBrokeredFilePath(f.projectRoot, mode, manifest(), f.grant), /regular-file targets/i);
  }
});
