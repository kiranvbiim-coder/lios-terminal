import assert from "node:assert/strict";
import test from "node:test";
import { buildInternalExecIntent } from "./authority/exec-intents";

test("market-history intent builds one fixed Python template with explicit script identity", () => {
  const plan = buildInternalExecIntent({
    intentId: "market.community.history",
    executable: "/managed/python3",
    scriptPath: "/app/script/download_history.py",
    symbol: "BRK-B",
    range: "3mo",
    interval: "1d",
  });
  assert.deepEqual(plan.argv, [
    "/managed/python3",
    "/app/script/download_history.py",
    "--symbol", "BRK-B",
    "--range", "3mo",
    "--interval", "1d",
  ]);
  assert.deepEqual(plan.operationFilePaths, ["/app/script/download_history.py"]);
  assert.equal(plan.envProfile, "python-runtime");
  assert.ok(plan.environmentKeys.includes("HTTPS_PROXY"));
  assert.equal(plan.timeoutMs, 60_000);
  assert.equal(plan.maxOutputChars, 50 * 1024 * 1024);
});

test("market-fundamentals intent has a smaller fixed argv and output budget", () => {
  const plan = buildInternalExecIntent({
    intentId: "market.community.fundamentals",
    executable: "python3",
    scriptPath: "./script/download_fundamentals.py",
    symbol: "BTC-USD",
  });
  assert.deepEqual(plan.argv, [
    "python3", "./script/download_fundamentals.py", "--symbol", "BTC-USD",
  ]);
  assert.deepEqual(plan.operationFilePaths, ["./script/download_fundamentals.py"]);
  assert.equal(plan.maxOutputChars, 10 * 1024 * 1024);
});

test("market intent rejects unsupported symbol, range and interval values", () => {
  assert.throws(() => buildInternalExecIntent({
    intentId: "market.community.history",
    executable: "python3",
    scriptPath: "./history.py",
    symbol: "AAPL;rm",
    range: "3mo",
    interval: "1d",
  }), /symbol/);
  assert.throws(() => buildInternalExecIntent({
    intentId: "market.community.history",
    executable: "python3",
    scriptPath: "./history.py",
    symbol: "AAPL",
    range: "forever",
    interval: "1d",
  }), /range/);
  assert.throws(() => buildInternalExecIntent({
    intentId: "market.community.history",
    executable: "python3",
    scriptPath: "./history.py",
    symbol: "AAPL",
    range: "3mo",
    interval: "--exec",
  }), /interval/);
});

test("unzip intent is fixed and binds the archive file", () => {
  const plan = buildInternalExecIntent({
    intentId: "archive.zip.extract.unzip",
    executable: "/usr/bin/unzip",
    archivePath: "/tmp/input.zip",
    destinationPath: "/tmp/out",
  });
  assert.deepEqual(plan.argv, [
    "/usr/bin/unzip", "-o", "-q", "/tmp/input.zip", "-d", "/tmp/out",
  ]);
  assert.deepEqual(plan.operationFilePaths, ["/tmp/input.zip"]);
  assert.equal(plan.envProfile, "default");
});

test("Python stdlib ZIP intent owns the fixed zipfile module shape", () => {
  const plan = buildInternalExecIntent({
    intentId: "archive.zip.extract.python-stdlib",
    executable: "python3",
    archivePath: "/tmp/input.zip",
    destinationPath: "/tmp/out",
  });
  assert.deepEqual(plan.argv, [
    "python3", "-m", "zipfile", "-e", "/tmp/input.zip", "/tmp/out",
  ]);
  assert.deepEqual(plan.operationFilePaths, ["/tmp/input.zip"]);
});

test("whisper intent binds executable inputs and does not accept arbitrary extra argv", () => {
  const plan = buildInternalExecIntent({
    intentId: "voice.whisper-cpp.transcribe",
    executable: "/opt/whisper",
    modelPath: "/models/ggml.bin",
    audioPath: "/tmp/audio.wav",
    language: "en-US",
    extraArgs: ["--prompt", "secret"] ,
  } as never);
  assert.deepEqual(plan.argv, [
    "/opt/whisper",
    "-m", "/models/ggml.bin",
    "-f", "/tmp/audio.wav",
    "-nt",
    "-l", "en-US",
  ]);
  assert.deepEqual(plan.operationFilePaths, [], "voice data/model provenance is owned outside execution-code hashing");
  assert.equal(JSON.stringify(plan).includes("secret"), false);
});

test("whisper language is optional but malformed values fail closed", () => {
  const plan = buildInternalExecIntent({
    intentId: "voice.whisper-cpp.transcribe",
    executable: "/opt/whisper",
    modelPath: "/models/ggml.bin",
    audioPath: "/tmp/audio.wav",
  });
  assert.equal(plan.argv.includes("-l"), false);
  const compatible = buildInternalExecIntent({
    intentId: "voice.whisper-cpp.transcribe",
    executable: "/opt/whisper",
    modelPath: "/models/ggml.bin",
    audioPath: "/tmp/audio.wav",
    language: "English_1",
  });
  assert.ok(compatible.argv.includes("English_1"));
  assert.throws(() => buildInternalExecIntent({
    intentId: "voice.whisper-cpp.transcribe",
    executable: "/opt/whisper",
    modelPath: "/models/ggml.bin",
    audioPath: "/tmp/audio.wav",
    language: "en;--prompt",
  }), /language/);
});

test("paths and executables reject NULs, option-shaped ambiguity and line breaks", () => {
  assert.throws(() => buildInternalExecIntent({
    intentId: "archive.zip.extract.unzip",
    executable: "-evil",
    archivePath: "/tmp/a.zip",
    destinationPath: "/tmp/out",
  }), /executable/);
  assert.throws(() => buildInternalExecIntent({
    intentId: "archive.zip.extract.unzip",
    executable: "unzip",
    archivePath: "-payload.zip",
    destinationPath: "/tmp/out",
  }), /archivePath/);
  assert.throws(() => buildInternalExecIntent({
    intentId: "archive.zip.extract.unzip",
    executable: "unzip",
    archivePath: "/tmp/a.zip",
    destinationPath: "/tmp/out\nnext",
  }), /destinationPath/);
  assert.throws(() => buildInternalExecIntent({
    intentId: "archive.zip.extract.python-stdlib",
    executable: "python\0evil",
    archivePath: "/tmp/a.zip",
    destinationPath: "/tmp/out",
  }), /executable/);
});

test("descriptor metadata is secret-safe and contains no environment values", () => {
  const plan = buildInternalExecIntent({
    intentId: "market.community.history",
    executable: "python3",
    scriptPath: "./history.py",
    symbol: "EURUSD=X",
    range: "1mo",
    interval: "1h",
  });
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes("https://proxy.example"), false);
  assert.equal(serialized.includes("PASSWORD"), false);
  assert.deepEqual(
    Object.keys(plan).sort(),
    [
      "envProfile", "environmentKeys", "intentId", "label", "maxOutputChars",
      "operationFilePaths", "timeoutMs", "version", "argv",
    ].sort(),
  );
});

test("intent descriptors are frozen snapshots, not mutable command templates", () => {
  const plan = buildInternalExecIntent({
    intentId: "archive.zip.extract.unzip",
    executable: "unzip",
    archivePath: "/tmp/a.zip",
    destinationPath: "/tmp/out",
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.argv), true);
  assert.equal(Object.isFrozen(plan.operationFilePaths), true);
  assert.equal(Object.isFrozen(plan.environmentKeys), true);
  assert.throws(() => {
    (plan.argv as string[])[0] = "changed";
  }, TypeError);
});

test("agent Python/data intent exact-binds code and uses isolated interpreter flags", () => {
  const plan = buildInternalExecIntent({
    intentId: "agent.python.data",
    executable: "/usr/bin/python3",
    code: "import json\nprint(json.dumps({\"answer\": 42}))",
  });
  assert.deepEqual(plan.argv, [
    "/usr/bin/python3",
    "-I",
    "-B",
    "-c",
    "import json\nprint(json.dumps({\"answer\": 42}))",
  ]);
  assert.deepEqual(plan.operationFilePaths, []);
  assert.equal(plan.envProfile, "default");
  assert.deepEqual(plan.environmentKeys, []);
  assert.equal(plan.timeoutMs, 120_000);
  assert.equal(plan.maxOutputChars, 1024 * 1024);
});

test("agent shell intent exact-binds the reviewed command and has no inherited environment authority", () => {
  const plan = buildInternalExecIntent({
    intentId: "agent.shell.command",
    executable: "/bin/sh",
    command: "printf '%s\\n' governed",
  });
  assert.deepEqual(plan.argv, ["/bin/sh", "-c", "printf '%s\\n' governed"]);
  assert.deepEqual(plan.operationFilePaths, []);
  assert.equal(plan.envProfile, "default");
  assert.deepEqual(plan.environmentKeys, []);
  assert.equal(plan.timeoutMs, 60_000);
  assert.equal(plan.maxOutputChars, 1024 * 1024);
});

test("agent execution payloads are bounded and reject NUL/blank input", () => {
  assert.throws(() => buildInternalExecIntent({
    intentId: "agent.python.data",
    executable: "/usr/bin/python3",
    code: "",
  }), /code/);
  assert.throws(() => buildInternalExecIntent({
    intentId: "agent.shell.command",
    executable: "/bin/sh",
    command: "echo ok\0echo nope",
  }), /command/);
  assert.throws(() => buildInternalExecIntent({
    intentId: "agent.python.data",
    executable: "/usr/bin/python3",
    code: "x".repeat(16 * 1024 + 1),
  }), /code/);
});

test("agent execution intent shape cannot be widened with arbitrary extra argv", () => {
  const plan = buildInternalExecIntent({
    intentId: "agent.shell.command",
    executable: "/bin/sh",
    command: "pwd",
    extraArgs: ["--", "rm", "-rf", "/"],
  } as never);
  assert.deepEqual(plan.argv, ["/bin/sh", "-c", "pwd"]);
  assert.equal(JSON.stringify(plan).includes("rm"), false);
});
