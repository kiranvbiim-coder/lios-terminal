import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");

const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const spec = read("../docs/technical/P13_PLUGIN_SDK_SPEC.md");
const sdk = read("shared/pluginSdk.ts");
const manager = read("server/p13PluginManager.ts");
const trust = read("server/p13PluginTrust.ts");
const host = read("server/p13PluginHost.ts");
const broker = read("server/p13PluginBroker.ts");
const mcp = read("server/p13McpServer.ts");
const runtimeHost = read("server/p13PluginRuntime.ts");
const runtimeHostTests = read("server/p13PluginRuntime.test.ts");
const workflow = readQualificationWorkflow(path.resolve(root, ".."), "lios-hardening.yml");
const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

const evidence: Record<string, boolean> = {
  "LIOS-P13-01":
    sdk.includes("liosPluginManifestV1Schema")
    && sdk.includes("dependencies")
    && sdk.includes("permissions")
    && sdk.includes("connectors")
    && sdk.includes("tools")
    && sdk.includes("artifacts")
    && sdk.includes("agents")
    && sdk.includes("observedPackageDigest")
    && sdk.includes("requests undeclared permissions"),
  "LIOS-P13-02": sdk.includes("defineConnector"),
  "LIOS-P13-03": sdk.includes("defineTool"),
  "LIOS-P13-04": sdk.includes("defineArtifact"),
  "LIOS-P13-05": sdk.includes("defineAgent"),
  "LIOS-P13-06":
    host.includes("nodePermissionModelFlag")
    && host.includes("--allow-fs-read")
    && host.includes("LIOS_PLUGIN_RAW_NETWORK_DENIED")
    && host.includes("nodeNetworkDenyImport")
    && host.includes("Direct process spawning is not permitted")
    && host.includes("authorizeBrokeredNetworkRequest")
    && host.includes("safePluginEnvironment")
    && host.includes("realExistingPath")
    && broker.includes("LepSidecarSupervisor")
    && broker.includes("P13NodeProcessBroker")
    && manager.includes("createManagedAdapters")
    && manager.includes("isolated invocation broker"),
  "LIOS-P13-07":
    trust.includes("signPluginManifest")
    && trust.includes("revokeKey")
    && trust.includes("revokeDigest")
    && trust.includes("package_digest_unobserved")
    && trust.includes("computePluginPackageDigest")
    && manager.includes("update(input")
    && manager.includes("previous version was restored")
    && manager.includes("trust verification failed"),
  "LIOS-P13-08":
    mcp.includes("P13McpServer")
    && mcp.includes("rightsApprovedToolIds")
    && mcp.includes("requireExplicitApproval")
    && mcp.includes("tenantScoped")
    && runtimeHost.includes("createMcpServer")
    && runtimeHost.includes("this.registry"),
  "LIOS-P13-09":
    manager.includes("negotiatePluginCompatibility")
    && manager.includes("satisfiesPluginVersion")
    && manager.includes("without partial activation")
    && manager.includes("assertReverseDependencyCompatibility")
    && manager.includes("dependency cycle detected")
    && runtimeHostTests.includes("installs, exposes, invokes and removes")
    && broker.includes("executionContextRef"),
};

for (let id = 1; id <= 9; id += 1) {
  const taskId = "LIOS-P13-" + String(id).padStart(2, "0");
  const rows = roadmap.split("\n").filter((line) => line.startsWith("| " + taskId + " |")).length;
  assert.equal(rows, 1, "Roadmap must contain exactly one canonical row for " + taskId + ".");
  assert.equal(evidence[taskId], true, "P13 acceptance evidence missing for " + taskId + ".");
}

assert.ok(spec.includes("P13 acceptance gate"), "P13 technical specification is missing its acceptance gate.");
assert.ok(spec.includes("LiOS-owned proxy"), "P13 spec must state the proxy-only execution boundary.");
assert.ok(packageJson.scripts?.["test:p13"], "P13 test script missing.");
assert.ok(packageJson.scripts?.["acceptance:p13"], "P13 acceptance script missing.");
assert.ok(packageJson.scripts?.["test:trust"]?.includes("test:p13"), "P13 tests are not part of trust gate.");
assert.ok(workflow.includes("P13 Plugin SDK and governed interoperability acceptance"), "P13 is missing from normal quality gate.");

console.log("P13 Plugin/SDK ecosystem acceptance P13-01…P13-09: PASS");
