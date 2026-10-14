import readline from "node:readline";
import fs from "node:fs";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const pendingNetwork = new Map();
const pendingFileReads = new Map();

rl.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.kind === "hello") {
    send({
      protocolVersion: "1",
      kind: "hello",
      requestId: message.requestId,
      packId: message.packId,
      packVersion: message.packVersion,
      componentId: message.componentId,
      componentVersion: message.componentVersion,
      capabilities: message.capabilities,
      schemaVersions: message.schemaVersions,
      platform: process.platform + "-" + process.arch,
      buildHash: null,
    });
    return;
  }

  if (message.kind === "execute") {
    const input = message.input?.input ?? {};
    let rawNetworkDenied = null;
    if (input.probeRawNetwork === true) {
      try {
        await fetch("https://example.com/");
        rawNetworkDenied = false;
      } catch (error) {
        rawNetworkDenied = String(error?.message ?? error).includes("LIOS_PLUGIN_RAW_NETWORK_DENIED");
      }
    }
    let rawFileReadDenied = null;
    if (input.probeRawFileRead === true) {
      try {
        fs.readFileSync(input.rawFilePath, "utf8");
        rawFileReadDenied = false;
      } catch (error) {
        rawFileReadDenied = error?.code === "ERR_ACCESS_DENIED";
      }
    }
    const complete = (brokeredNetworkError = null, fileResult = {}) => send({
      protocolVersion: "1",
      kind: "result",
      requestId: message.requestId,
      capability: message.capability,
      outputSchemaVersion: message.outputSchemaVersion,
      result: {
        operation: message.input?.operation ?? null,
        echoed: input,
        inheritedEnvironmentValue: typeof input.checkEnv === "string"
          ? (process.env[input.checkEnv] ?? null)
          : null,
        rawNetworkDenied,
        brokeredNetworkError,
        rawFileReadDenied,
        fileBrokerEnvironment: process.env.LIOS_PLUGIN_FILESYSTEM_BROKER ?? null,
        ...fileResult,
      },
      dataRefs: [],
    });

    if (input.probeBrokeredPrivateNetwork === true) {
      const brokerRequestId = "33333333-3333-4333-8333-" + String(Date.now()).slice(-12).padStart(12, "0");
      pendingNetwork.set(brokerRequestId, complete);
      send({
        protocol: "lios-plugin-broker/1",
        kind: "network.request",
        requestId: brokerRequestId,
        executionRequestId: message.requestId,
        componentId: message.input?.componentId ?? null,
        url: "http://127.0.0.1/",
        method: "GET",
        headers: {},
        bodyBase64: null,
        credentialHandle: null,
        timeoutMs: 1000,
        maxResponseBytes: 1024,
      });
      return;
    }

    if (input.probeBrokeredFileRead === true) {
      const fileRequestId = "44444444-4444-4444-8444-" + String(Date.now()).slice(-12).padStart(12, "0");
      pendingFileReads.set(fileRequestId, complete);
      send({
        protocol: "lios-plugin-broker/1",
        kind: "filesystem.read",
        requestId: fileRequestId,
        executionRequestId: message.requestId,
        componentId: message.input?.componentId ?? null,
        scope: "project",
        rootIndex: 0,
        relativePath: input.relativePath ?? "input.txt",
        maxBytes: 1024,
      });
      return;
    }

    complete();
    return;
  }

  if (message.protocol === "lios-plugin-broker/1" && (message.kind === "filesystem.error" || message.kind === "filesystem.response")) {
    const complete = pendingFileReads.get(message.requestId);
    if (complete) {
      pendingFileReads.delete(message.requestId);
      complete(null, message.kind === "filesystem.response"
        ? { brokeredFileText: Buffer.from(message.bodyBase64, "base64").toString("utf8"), brokeredFileError: null }
        : { brokeredFileText: null, brokeredFileError: message.code });
    }
    return;
  }

  if (message.protocol === "lios-plugin-broker/1" && (message.kind === "network.error" || message.kind === "network.response")) {
    const complete = pendingNetwork.get(message.requestId);
    if (complete) {
      pendingNetwork.delete(message.requestId);
      complete(message.kind === "network.error" ? message.code : null);
    }
    return;
  }

  if (message.kind === "shutdown") process.exit(0);
});
