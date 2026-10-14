import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import test from "node:test";
import {
  prepareWorkspaceTransfer,
  validateWorkspaceWriteReturnDestination,
  readWorkspaceRegularFile,
  type ExecutionWorkspaceTransferRequest,
} from "./workspace-transfer";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-workspace-transfer-"));
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "input.txt"), "alpha");
  fs.writeFileSync(path.join(root, "nested", "input.txt"), "beta");
  return root;
}

function request(root: string, overrides: Partial<ExecutionWorkspaceTransferRequest> = {}): ExecutionWorkspaceTransferRequest {
  return {
    root,
    inputs: ["input.txt", "nested/input.txt"],
    mode: "ingress-only",
    ...overrides,
  };
}

test("snapshots explicit regular files with stable hashes and deterministic tar stdin", () => {
  const root = fixture();
  try {
    const first = prepareWorkspaceTransfer(request(root));
    const second = prepareWorkspaceTransfer(request(root));
    assert.equal(first.stdinBase64, second.stdinBase64);
    assert.deepEqual(first.facts.inputs.map(({ path, size }) => ({ path, size })), [
      { path: "input.txt", size: 5 },
      { path: "nested/input.txt", size: 4 },
    ]);
    assert.match(first.facts.inputs[0]!.sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(first.facts).includes(root), false, "receipt-safe facts do not expose host root");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects traversal, absolute/backslash/colon paths and duplicates", () => {
  const root = fixture();
  try {
    for (const bad of [
      "../secret", "/etc/passwd", "a\\b", "C:/secret", "a/../../b",
      "nested/../input.txt", "./input.txt", "nested/./input.txt", "nested//input.txt",
    ]) {
      assert.throws(() => prepareWorkspaceTransfer(request(root, { inputs: [bad] })));
    }
    assert.throws(() => prepareWorkspaceTransfer(request(root, { inputs: ["input.txt", "input.txt"] })), /duplicate/);
    assert.throws(() => prepareWorkspaceTransfer(request(root, { inputs: ["input.txt", "./input.txt"] })), /dot segments/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("raw output paths reject traversal spelling before normalization", () => {
  const root = fixture();
  try {
    // These normalized to existing canonical names before the GM-11/P13 repair.
    // An authorized output path must be exact, not an alias for another path.
    for (const bad of [
      "./result.txt", "nested/../result.txt", "nested/./result.txt",
      "nested//result.txt", "nested/.", "nested/..", "nested/result.txt/",
    ]) {
      assert.throws(
        () => prepareWorkspaceTransfer(request(root, { mode: "write-return", outputs: [bad] })),
        /empty or dot segments/,
        bad,
      );
    }
    const valid = prepareWorkspaceTransfer(request(root, {
      mode: "write-return",
      outputs: ["result.txt", "nested/result.txt"],
    }));
    assert.deepEqual(valid.facts.outputs, ["result.txt", "nested/result.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects symlinks, directories, sockets/non-regular files and oversized inputs", () => {
  const root = fixture();
  try {
    if (process.platform !== "win32") {
      fs.symlinkSync("input.txt", path.join(root, "link.txt"));
      assert.throws(() => prepareWorkspaceTransfer(request(root, { inputs: ["link.txt"] })), /symbolic links/);
    }
    assert.throws(() => prepareWorkspaceTransfer(request(root, { inputs: ["nested"] })), /regular files/);
    assert.throws(
      () => prepareWorkspaceTransfer(request(root, { inputs: ["input.txt"], maxFileBytes: 4, maxTotalBytes: 8 })),
      /exceeds 4 bytes/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects Unix sockets as non-regular inputs", { skip: process.platform === "win32" }, async () => {
  const root = fixture();
  const socketPath = path.join(root, "socket");
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    assert.throws(
      () => prepareWorkspaceTransfer(request(root, { inputs: ["socket"] })),
      /regular files/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ingress-only mode cannot declare returned outputs", () => {
  const root = fixture();
  try {
    assert.throws(
      () => prepareWorkspaceTransfer(request(root, { outputs: ["result.txt"] })),
      /cannot declare returned outputs/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const TOKEN = "a".repeat(64);

function exit(code = 0) {
  return {
    reason: "exit" as const,
    exitCode: code,
    exitSignal: null,
    durationMs: 1,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    noOutputTimedOut: false,
  };
}

function frame(...files: Buffer[]): Buffer {
  const lines = [`\nLIOS-OUTPUT-${TOKEN}-BEGIN\n`];
  files.forEach((file, index) => {
    lines.push(`LIOS-OUTPUT-${TOKEN}-FILE-${index}\n`, file.toString("base64"), "\n");
  });
  lines.push(`\nLIOS-OUTPUT-${TOKEN}-DONE\n`);
  return Buffer.from(lines.join(""));
}

test("write-return accepts exact declared bytes after child exit and keeps raw frames out of diagnostics", () => {
  const root = fixture();
  try {
    const prepared = prepareWorkspaceTransfer(request(root, {
      mode: "write-return",
      inputs: [],
      outputs: ["result.txt", "nested/empty.txt"],
    }));
    const stream = prepared.createOutputStream(TOKEN, 256);
    const returned = frame(Buffer.from([0, 255, 1]), Buffer.alloc(0));
    stream.onStdout(Buffer.from("user-visible\n"));
    for (let offset = 0; offset < returned.length; offset += 3) {
      stream.onStdout(returned.subarray(offset, offset + 3));
    }
    stream.onStderr(Buffer.from("bounded diagnostic"));
    const sanitized = stream.acceptExit(exit());
    assert.equal(sanitized.stdout, "user-visible\n");
    assert.equal(sanitized.stderr, "bounded diagnostic");
    assert.equal(sanitized.stdout.includes(TOKEN), false);
    const outputs = stream.collectOutputs();
    assert.deepEqual(outputs.map((file) => file.path), ["result.txt", "nested/empty.txt"]);
    assert.deepEqual(outputs[0]!.data, Buffer.from([0, 255, 1]));
    assert.equal(outputs[1]!.size, 0);
    assert.match(outputs[0]!.sha256, /^[a-f0-9]{64}$/);
    assert.equal(prepared.outputScript().includes(TOKEN), false, "token never enters argv");
    assert.match(prepared.outputScript(), /\[ -L 'nested' \]/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing tmpfs bytes, malformed frames, undeclared data and size violations fail closed", () => {
  const root = fixture();
  try {
    const prepared = prepareWorkspaceTransfer(request(root, {
      mode: "write-return",
      inputs: [],
      outputs: ["result.txt"],
      maxFileBytes: 4,
      maxTotalBytes: 4,
    }));
    for (const raw of [
      Buffer.alloc(0),
      frame(Buffer.from("12345")),
      frame(Buffer.from("ok")).subarray(0, -6),
      Buffer.concat([frame(Buffer.from("ok")), Buffer.from("undeclared")]),
      Buffer.from(`\nLIOS-OUTPUT-${TOKEN}-BEGIN\nLIOS-OUTPUT-${TOKEN}-FILE-0\n!not-base64!\n\nLIOS-OUTPUT-${TOKEN}-DONE\n`),
    ]) {
      const stream = prepared.createOutputStream(TOKEN, 256);
      stream.onStdout(raw);
      stream.acceptExit(exit());
      assert.throws(() => stream.collectOutputs(), /Workspace output return/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unauthenticated child stdout cannot forge a return and nonzero child exits withhold outputs", () => {
  const root = fixture();
  try {
    const prepared = prepareWorkspaceTransfer(request(root, {
      mode: "write-return",
      inputs: [],
      outputs: ["result.txt"],
    }));
    const forged = prepared.createOutputStream(TOKEN, 256);
    forged.onStdout(Buffer.from(frame(Buffer.from("bad")).toString().replaceAll(TOKEN, "b".repeat(64))));
    forged.acceptExit(exit());
    assert.throws(() => forged.collectOutputs(), /incomplete/);
    const failed = prepared.createOutputStream(TOKEN, 256);
    failed.onStdout(frame(Buffer.from("hidden")));
    const diagnostic = failed.acceptExit(exit(2));
    assert.equal(diagnostic.stdout.includes("hidden"), false);
    assert.deepEqual(failed.collectOutputs(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("shell bridge reads only declared regular outputs and refuses symlink paths", { skip: process.platform === "win32" }, () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, "result.txt"), "actual");
    fs.writeFileSync(path.join(root, "unlisted.txt"), "private");
    const prepared = prepareWorkspaceTransfer(request(root, {
      mode: "write-return",
      outputs: ["result.txt"],
    }));
    const run = () => spawnSync("/bin/sh", [
      "-c", 'token=$1; base64_path=base64; ' + prepared.outputScript(), "lios-test", TOKEN,
    ], { cwd: root, encoding: "utf8" });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout.includes("private"), false);
    const stream = prepared.createOutputStream(TOKEN, 256);
    stream.onStdout(Buffer.from(first.stdout));
    stream.acceptExit(exit());
    assert.equal(stream.collectOutputs()[0]?.data.toString(), "actual");

    fs.rmSync(path.join(root, "result.txt"));
    fs.symlinkSync("unlisted.txt", path.join(root, "result.txt"));
    assert.equal(run().status, 82);

    const nested = prepareWorkspaceTransfer(request(root, {
      mode: "write-return",
      outputs: ["nested/result.txt"],
    }));
    fs.rmSync(path.join(root, "nested"), { recursive: true });
    fs.symlinkSync(root, path.join(root, "nested"));
    const parentLink = spawnSync("/bin/sh", [
      "-c", 'token=$1; base64_path=base64; ' + nested.outputScript(), "lios-test", TOKEN,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(parentLink.status, 82);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bounded P13 copy-only read shares GM workspace regular-file and symlink guards", () => {
  const root = fixture();
  try {
    const good = readWorkspaceRegularFile({ root, relativePath: "nested/input.txt", maxFileBytes: 8 });
    assert.equal(good.data.toString("utf8"), "beta");
    assert.equal(good.size, 4);
    assert.match(good.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify({path:good.path,sha256:good.sha256}).includes(root));
    assert.throws(() => readWorkspaceRegularFile({root,relativePath:"../escape"}), /relative|escape|segments/i);
    for (const bad of ["nested/../input.txt", "nested/./input.txt", "./input.txt", "nested//input.txt"]) {
      assert.throws(
        () => readWorkspaceRegularFile({root,relativePath:bad}),
        /empty or dot segments/,
        bad,
      );
    }
    assert.throws(() => readWorkspaceRegularFile({root,relativePath:"input.txt",maxFileBytes:4}), /exceeds 4 bytes/);
    if (process.platform !== "win32") {
      fs.symlinkSync("input.txt",path.join(root,"linked.txt"));
      assert.throws(() => readWorkspaceRegularFile({root,relativePath:"linked.txt"}), /symbolic links/i);
    }
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test("GM workspace write-return staging admits new relative regular-file names but cannot overwrite or follow links", () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "lios-outside-write-"));
  try {
    assert.equal(validateWorkspaceWriteReturnDestination({ root, relativePath: "new.txt" }), "new.txt");
    assert.equal(validateWorkspaceWriteReturnDestination({ root, relativePath: "nested/new.txt" }), "nested/new.txt");
    for (const bad of ["input.txt", "nested", "nested/input.txt", "../escape", "/etc/passwd", "missing/new.txt", "nested/../new.txt", "nested//new.txt"]) {
      assert.throws(() => validateWorkspaceWriteReturnDestination({ root, relativePath: bad }));
    }
    if (process.platform !== "win32") {
      fs.symlinkSync(path.join(outside, "not-created.txt"), path.join(root, "dangling.txt"));
      fs.symlinkSync(outside, path.join(root, "linked-parent"));
      assert.throws(() => validateWorkspaceWriteReturnDestination({root,relativePath:"dangling.txt"}), /symbolic links/i);
      assert.throws(() => validateWorkspaceWriteReturnDestination({root,relativePath:"linked-parent/new.txt"}), /symbolic links/i);
    }
    assert.equal(fs.existsSync(path.join(root, "new.txt")), false, "validation must be side-effect free");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
