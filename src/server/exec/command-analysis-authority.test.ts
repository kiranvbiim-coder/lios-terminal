import assert from "node:assert/strict";
import test from "node:test";
import { analyzeExecutionCommand } from "./authority/command-analysis";

test("identifies direct Node script and preload/import file operands", () => {
  assert.deepEqual(analyzeExecutionCommand([
    "node", "-r", "./hook.cjs", "--import=./loader.mjs", "app.mjs", "--flag",
  ]), {
    version: 1,
    analyzable: true,
    reason: null,
    kind: "node",
    executable: "node",
    carriers: [],
    environmentAssignmentKeys: [],
    operationFilePaths: ["./hook.cjs", "./loader.mjs", "app.mjs"],
    inlineEvaluation: null,
  });
});

test("refuses unresolved Node package preload instead of pretending its code identity is bound", () => {
  const result = analyzeExecutionCommand(["node", "--require", "some-package", "app.js"]);
  assert.equal(result.analyzable, false);
  assert.equal(result.reason, "module-specifier-requires-resolution");
  assert.deepEqual(result.operationFilePaths, []);
});

test("Node inline evaluation is classified without retaining its code payload", () => {
  const secretCode = "console.log('private-inline-payload')";
  const result = analyzeExecutionCommand(["node", "-e", secretCode]);
  assert.equal(result.analyzable, true);
  assert.equal(result.inlineEvaluation, "node");
  assert.equal(JSON.stringify(result).includes(secretCode), false);
});

test("identifies Python scripts, but module execution requires later module resolution", () => {
  assert.deepEqual(analyzeExecutionCommand(["python3", "-u", "jobs/run.py", "--mode", "safe"]).operationFilePaths, ["jobs/run.py"]);
  const moduleRun = analyzeExecutionCommand(["python", "-m", "package.worker"]);
  assert.equal(moduleRun.analyzable, false);
  assert.equal(moduleRun.reason, "module-specifier-requires-resolution");
});

test("Python options with separate and attached values do not become script operands", () => {
  const long = analyzeExecutionCommand(["python", "--check-hash-based-pycs", "always", "job.py"]);
  assert.equal(long.analyzable, true);
  assert.deepEqual(long.operationFilePaths, ["job.py"]);
  const attached = analyzeExecutionCommand(["python", "-Wignore", "-Xdev", "job.py"]);
  assert.equal(attached.analyzable, true);
  assert.deepEqual(attached.operationFilePaths, ["job.py"]);
});

test("Python inline evaluation is classified without retaining payload", () => {
  const payload = "print('secret-python-code')";
  const result = analyzeExecutionCommand(["python", "-c", payload]);
  assert.equal(result.analyzable, true);
  assert.equal(result.inlineEvaluation, "python");
  assert.equal(JSON.stringify(result).includes(payload), false);
});

test("POSIX shell script is bindable but inline shell command requires full shell analysis", () => {
  const script = analyzeExecutionCommand(["bash", "./build.sh", "--release"]);
  assert.equal(script.analyzable, true);
  assert.deepEqual(script.operationFilePaths, ["./build.sh"]);

  const payload = "node ./job.js && rm -rf ./tmp";
  const inline = analyzeExecutionCommand(["bash", "-lc", payload]);
  assert.equal(inline.analyzable, false);
  assert.equal(inline.reason, "inline-shell-payload-requires-shell-analysis");
  assert.equal(JSON.stringify(inline).includes(payload), false);
});

test("shell startup files are bound and stdin-driven shells are refused", () => {
  const configured = analyzeExecutionCommand(["bash", "--rcfile", "./bashrc", "./build.sh"]);
  assert.equal(configured.analyzable, true);
  assert.deepEqual(configured.operationFilePaths, ["./bashrc", "./build.sh"]);

  const configuredInline = analyzeExecutionCommand(["bash", "--init-file=./init.sh", "./build.sh"]);
  assert.deepEqual(configuredInline.operationFilePaths, ["./init.sh", "./build.sh"]);

  assert.equal(analyzeExecutionCommand(["bash"]).reason, "shell-stdin-payload-requires-shell-analysis");
  assert.equal(analyzeExecutionCommand(["bash", "-s"]).reason, "shell-stdin-payload-requires-shell-analysis");
  assert.equal(analyzeExecutionCommand(["bash", "--"]).reason, "shell-stdin-payload-requires-shell-analysis");
});

test("unknown shell options fail closed instead of shifting the script operand", () => {
  const result = analyzeExecutionCommand(["bash", "--unknown-option", "value", "./build.sh"]);
  assert.equal(result.analyzable, false);
  assert.equal(result.reason, "interpreter-option-unrecognized");
  assert.deepEqual(result.operationFilePaths, []);
});

test("env assignments are unwrapped by key only and never expose values", () => {
  const secret = "do-not-persist-this";
  const result = analyzeExecutionCommand(["env", `API_TOKEN=${secret}`, "python", "job.py"]);
  assert.equal(result.analyzable, true);
  assert.deepEqual(result.carriers, ["env"]);
  assert.deepEqual(result.environmentAssignmentKeys, ["API_TOKEN"]);
  assert.deepEqual(result.operationFilePaths, ["job.py"]);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("attached sudo option values cannot masquerade as shell-mode flags", () => {
  const result = analyzeExecutionCommand(["sudo", "-uperson", "python", "job.py"]);
  assert.equal(result.analyzable, true);
  assert.deepEqual(result.carriers, ["sudo"]);
  assert.deepEqual(result.operationFilePaths, ["job.py"]);
});

test("sudo environment assignments are retained by key only", () => {
  const secret = "private-sudo-env";
  const result = analyzeExecutionCommand(["sudo", `TOKEN=${secret}`, "python", "job.py"]);
  assert.equal(result.analyzable, true);
  assert.deepEqual(result.environmentAssignmentKeys, ["TOKEN"]);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("nested carriers resolve to the interpreter and preserve only safe carrier facts", () => {
  const result = analyzeExecutionCommand([
    "sudo", "-u", "worker",
    "env", "MODE=safe",
    "command", "-p",
    "python3", "task.py",
  ]);
  assert.equal(result.analyzable, true);
  assert.deepEqual(result.carriers, ["sudo", "env", "command"]);
  assert.deepEqual(result.environmentAssignmentKeys, ["MODE"]);
  assert.equal(result.kind, "python");
  assert.deepEqual(result.operationFilePaths, ["task.py"]);
});

test("doas and exec carriers unwrap deterministically", () => {
  const result = analyzeExecutionCommand(["doas", "-u", "worker", "exec", "-a", "python", "python", "job.py"]);
  assert.equal(result.analyzable, true);
  assert.deepEqual(result.carriers, ["doas", "exec"]);
  assert.equal(result.kind, "python");
  assert.deepEqual(result.operationFilePaths, ["job.py"]);
});

test("env split-string payload is refused without retaining shell text", () => {
  const payload = "python job.py --token private";
  const result = analyzeExecutionCommand(["env", "-S", payload]);
  assert.equal(result.analyzable, false);
  assert.equal(result.reason, "carrier-split-payload-requires-shell-analysis");
  assert.equal(JSON.stringify(result).includes(payload), false);
});

test("carrier shell modes require the later shell-analysis layer", () => {
  for (const argv of [
    ["sudo", "-s"],
    ["sudo", "--login"],
    ["doas", "-s"],
  ]) {
    const result = analyzeExecutionCommand(argv);
    assert.equal(result.analyzable, false);
    assert.equal(result.reason, "carrier-shell-mode-requires-shell-analysis");
  }
});

test("env short split-string mode is refused without retaining payload", () => {
  const payload = "python secret-job.py";
  const result = analyzeExecutionCommand(["env", "-s", payload]);
  assert.equal(result.analyzable, false);
  assert.equal(result.reason, "carrier-split-payload-requires-shell-analysis");
  assert.equal(JSON.stringify(result).includes(payload), false);
});

test("unknown carrier options fail closed", () => {
  const result = analyzeExecutionCommand(["sudo", "--made-up-option", "node", "app.js"]);
  assert.equal(result.analyzable, false);
  assert.equal(result.reason, "carrier-option-unrecognized");
});

test("unknown executable operands stay unclassified until an ExecIntent or analyzer owns them", () => {
  const result = analyzeExecutionCommand(["custom-tool", "config.json"]);
  assert.equal(result.analyzable, false);
  assert.equal(result.reason, "unclassified-command-operands");
  assert.equal(result.executable, "custom-tool");
  assert.deepEqual(result.operationFilePaths, []);
});

test("invalid argv and NUL-bearing tokens fail closed", () => {
  assert.equal(analyzeExecutionCommand([]).reason, "invalid-argv");
  assert.equal(analyzeExecutionCommand(["node\0evil", "app.js"]).reason, "invalid-argv");
});


test("carrier recursion is bounded and never falls through to a partially unwrapped command", () => {
  const argv = [...Array.from({ length: 17 }, () => "env"), "python", "job.py"];
  const result = analyzeExecutionCommand(argv);
  assert.equal(result.analyzable, false);
  assert.equal(result.reason, "carrier-depth-exceeded");
  assert.equal(result.carriers.length, 16);
  assert.deepEqual(result.operationFilePaths, []);
});
