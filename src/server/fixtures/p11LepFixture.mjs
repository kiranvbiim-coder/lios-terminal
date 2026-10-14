import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const active = new Map();

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.kind === "hello") {
    send({
      protocolVersion: "1",
      kind: "hello",
      requestId: message.requestId,
      packId: "lios.fixture",
      packVersion: "1.0.0",
      componentId: "fixture:sidecar",
      componentVersion: "1.0.0",
      capabilities: ["pricing.derivatives.black_scholes"],
      schemaVersions: { input: "1", output: "1" },
      platform: process.platform + "-" + process.arch,
      buildHash: null,
    });
    return;
  }
  if (message.kind === "execute") {
    if (message.input?.crash === true) process.exit(7);
    if (message.input?.neverRespond === true) {
      if (message.input?.ignoreSigterm === true) process.on("SIGTERM", () => {});
      return;
    }
    const complete = () => {
      active.delete(message.requestId);
      const result = { echoed: message.input };
      if (typeof message.input?.checkEnv === "string") {
        result.inheritedEnvironmentValue = process.env[message.input.checkEnv] ?? null;
      }
      send({
        protocolVersion: "1",
        kind: "result",
        requestId: message.requestId,
        capability: message.capability,
        outputSchemaVersion: message.outputSchemaVersion,
        result,
        dataRefs: [],
      });
    };
    if (typeof message.input?.delayMs === "number") {
      const timer = setTimeout(complete, message.input.delayMs);
      active.set(message.requestId, timer);
    } else complete();
    return;
  }
  if (message.kind === "cancel") {
    const timer = active.get(message.targetRequestId);
    if (timer) {
      clearTimeout(timer);
      active.delete(message.targetRequestId);
      send({
        protocolVersion: "1",
        kind: "error",
        requestId: message.targetRequestId,
        code: "cancelled",
        message: "Execution cancelled",
        retryable: false,
      });
    }
    return;
  }
  if (message.kind === "diagnostics") {
    send({
      protocolVersion: "1",
      kind: "diagnostics",
      requestId: message.requestId,
      diagnostics: { fixture: true },
    });
    return;
  }
  if (message.kind === "shutdown") process.exit(0);
});
