import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runContainerControlCommand } from "../server/exec/backends/container-lifecycle";
import type { ExecutionBackendRequest } from "../server/exec/backends/types";
import { runExecutionBackendRequest } from "../server/exec/run-backend";
import { requireStrictSandboxRuntime } from "../server/exec/sandbox-runtime-profile";
import {
  assertIsolationV2Accepted,
  buildIsolationV2Evidence,
  type IsolationV2Check,
} from "../server/exec/isolation-v2-evidence";
import { assertBrowserRuntimeIsolationBackend } from "../server/exec/browser-isolation";
import { SI01_ISOLATION_COVERAGE } from "../server/exec/isolation-coverage";
import { parseLocalDocumentWithDoclingIsolated } from "../server/p7DocumentIntelligence";
import { resolveConversationAttachmentContentIsolated } from "../server/projectAttachmentContent";
import { parseSpreadsheetArtifactImportIsolated } from "../server/spreadsheetArtifactImport";
import { conversationAttachmentRefSchema } from "../shared/conversationRuntime";
import { nodePermissionExecutionBackend } from "../server/exec/backends/node-permission";

function simplePdf(text: string): Buffer {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    body += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function config() {
  const runtime = requireStrictSandboxRuntime();
  return {
    backend: runtime.backend,
    engine: runtime.engine!,
    engineTarget: runtime.engineTarget!,
    image: runtime.image!,
    user: runtime.user!,
    shell: runtime.tools.shell!,
    base64: runtime.tools.base64!,
    tar: runtime.tools.tar!,
    python: runtime.tools.python!,
    spreadsheetNode: runtime.tools.node!,
    spreadsheetXlsx: runtime.tools.xlsxModule!,
    doclingFixture: process.env.LIOS_SI01_V2_DOCLING_FIXTURE?.trim() || null,
    evidencePath: process.env.LIOS_SI01_V2_EVIDENCE_PATH?.trim() || null,
  } as const;
}

function request(
  argv: string[],
  overrides: Partial<ExecutionBackendRequest> = {},
): ExecutionBackendRequest {
  return {
    argv,
    isolation: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    resources: {
      maxWallTimeMs: 30_000,
      maxCapturedOutputChars: 64 * 1024,
      maxMemoryBytes: 256 * 1024 * 1024,
      maxProcesses: 16,
    },
    ...overrides,
  };
}

async function main() {
  const cfg = config();
  const checks: IsolationV2Check[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-si01-v2-"));

  const backend = cfg.backend;

  async function requiredCheck(
    id: string,
    run: () => Promise<Record<string, unknown> | void>,
  ) {
    try {
      const evidence = await run();
      checks.push({
        id,
        required: true,
        status: "pass",
        detail: "Required isolation guarantee proved on the target runtime.",
        ...(evidence ? { evidence } : {}),
      });
    } catch (error) {
      checks.push({
        id,
        required: true,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await requiredCheck("workspace_copy_bridge", async () => {
      const input = Buffer.from("alpha-" + crypto.randomUUID(), "utf8");
      fs.writeFileSync(path.join(root, "input.txt"), input);
      const result = await runExecutionBackendRequest(
        backend,
        request([cfg.shell, "-c", "cat input.txt > result.txt"], {
          workspaceTransfer: {
            root,
            inputs: ["input.txt"],
            outputs: ["result.txt"],
            mode: "write-return",
            maxFileBytes: 1024 * 1024,
            maxTotalBytes: 2 * 1024 * 1024,
          },
        }),
      );
      if (result.exit.reason !== "exit" || result.exit.exitCode !== 0) {
        throw new Error(`workspace bridge command failed (${result.exit.reason}/${result.exit.exitCode})`);
      }
      const returned = result.finalization.workspaceOutputs?.find((file) => file.path === "result.txt");
      if (!returned || !returned.data.equals(input)) {
        throw new Error("declared workspace output did not round-trip exact input bytes.");
      }
      const hostPathPresentInFacts = JSON.stringify(result.facts).includes(root);
      if (hostPathPresentInFacts) {
        throw new Error("workspace bridge leaked the host staging path into receipt-safe backend facts.");
      }
      return {
        generationId: result.facts.runtimeGenerationId,
        inputSha256: result.facts.workspaceTransfer?.inputs[0]?.sha256,
        outputSha256: returned.sha256,
        hostPathPresentInFacts: false,
      };
    });

    await requiredCheck("host_filesystem_denial", async () => {
      const marker = path.join(os.tmpdir(), "lios-host-only-" + crypto.randomUUID());
      fs.writeFileSync(marker, "host-only", { mode: 0o600 });
      try {
        const code = [
          "import os,sys",
          "sys.exit(41 if os.path.exists(sys.argv[1]) else 0)",
        ].join("; ");
        const result = await runExecutionBackendRequest(
          backend,
          request([cfg.python, "-c", code, marker]),
        );
        if (result.exit.reason !== "exit" || result.exit.exitCode !== 0) {
          throw new Error("container observed a host-only path or filesystem probe failed.");
        }
        return { generationId: result.facts.runtimeGenerationId, hostPathVisible: false };
      } finally {
        fs.rmSync(marker, { force: true });
      }
    });

    await requiredCheck("network_denial", async () => {
      const code = [
        "import socket,sys",
        "s=socket.socket()",
        "s.settimeout(1)",
        "ok=False",
        "try:",
        " s.connect(('1.1.1.1',53)); ok=True",
        "except OSError:",
        " pass",
        "finally:",
        " s.close()",
        "sys.exit(41 if ok else 0)",
      ].join("\n");
      const result = await runExecutionBackendRequest(
        backend,
        request([cfg.python, "-c", code]),
      );
      if (result.exit.reason !== "exit" || result.exit.exitCode !== 0) {
        throw new Error("sandbox established an external network connection or denial probe failed.");
      }
      return { generationId: result.facts.runtimeGenerationId, externalConnectSucceeded: false };
    });

    await requiredCheck("pid_limit", async () => {
      const code = [
        "import subprocess,sys,time",
        "children=[]",
        "limited=False",
        "try:",
        " for _ in range(32):",
        "  try:",
        "   children.append(subprocess.Popen([sys.executable,'-c','import time; time.sleep(10)']))",
        "  except OSError:",
        "   limited=True; break",
        "finally:",
        " [p.terminate() for p in children if p.poll() is None]",
        "sys.exit(0 if limited else 41)",
      ].join("\n");
      const result = await runExecutionBackendRequest(
        backend,
        request([cfg.python, "-c", code], {
          resources: {
            maxWallTimeMs: 30_000,
            maxCapturedOutputChars: 64 * 1024,
            maxMemoryBytes: 256 * 1024 * 1024,
            maxProcesses: 8,
          },
        }),
      );
      if (result.exit.reason !== "exit" || result.exit.exitCode !== 0) {
        throw new Error("sandbox did not enforce the requested process-count ceiling.");
      }
      return { generationId: result.facts.runtimeGenerationId, requestedMaxProcesses: 8 };
    });

    await requiredCheck("runtime_hardening", async () => {
      const code = [
        "import json,os",
        "status={}",
        "for line in open('/proc/self/status','r',encoding='utf-8'):",
        " parts=line.split(':',1)",
        " if len(parts)==2: status[parts[0].strip()]=parts[1].strip()",
        "root_line=next((line for line in open('/proc/mounts','r',encoding='utf-8') if line.split()[1]=='/'), '')",
        "root_opts=root_line.split()[3].split(',') if root_line else []",
        "print(json.dumps({'euid':os.geteuid(),'capEff':status.get('CapEff'),'noNewPrivs':status.get('NoNewPrivs'),'rootReadOnly':'ro' in root_opts}))",
      ].join("\n");
      const result = await runExecutionBackendRequest(
        backend,
        request([cfg.python, "-c", code]),
      );
      if (result.exit.reason !== "exit" || result.exit.exitCode !== 0) {
        throw new Error("sandbox hardening probe failed to execute.");
      }
      const observed = JSON.parse(result.exit.stdout.trim()) as {
        euid?: unknown;
        capEff?: unknown;
        noNewPrivs?: unknown;
        rootReadOnly?: unknown;
      };
      if (typeof observed.euid !== "number" || observed.euid === 0) {
        throw new Error("sandbox process is running as root.");
      }
      if (observed.capEff !== "0000000000000000") {
        throw new Error(`sandbox retained effective Linux capabilities: ${String(observed.capEff)}`);
      }
      if (observed.noNewPrivs !== "1") {
        throw new Error("sandbox did not prove no-new-privileges.");
      }
      if (observed.rootReadOnly !== true) {
        throw new Error("sandbox root filesystem was not observed read-only.");
      }
      return {
        generationId: result.facts.runtimeGenerationId,
        euid: observed.euid,
        capEff: observed.capEff,
        noNewPrivs: observed.noNewPrivs,
        rootReadOnly: observed.rootReadOnly,
      };
    });

    await requiredCheck("cancel_extinction", async () => {
      const controller = new AbortController();
      const running = runExecutionBackendRequest(
        backend,
        request([cfg.python, "-c", "import time; time.sleep(30)"], {
          signal: controller.signal,
          resources: {
            maxWallTimeMs: 60_000,
            maxCapturedOutputChars: 16 * 1024,
            maxMemoryBytes: 128 * 1024 * 1024,
            maxProcesses: 8,
          },
        }),
      );
      const timer = setTimeout(() => controller.abort(new Error("V2 cancellation probe")), 250);
      timer.unref?.();
      const result = await running;
      clearTimeout(timer);
      if (result.exit.reason !== "manual-cancel") {
        throw new Error(`cancelled run ended as ${result.exit.reason}, not manual-cancel.`);
      }
      const generationId = result.facts.runtimeGenerationId;
      if (!generationId) throw new Error("container run did not expose a receipt-safe generation id.");
      const inspected = await runContainerControlCommand([
        cfg.engine,
        cfg.engine === "docker" ? "--host=" + cfg.engineTarget : "--url=" + cfg.engineTarget,
        "inspect",
        "--format",
        "{{.Id}}",
        generationId,
      ]);
      if (inspected.code === 0) {
        throw new Error("cancelled container generation remained observable after finalization.");
      }
      const absence = (inspected.stderr + "\n" + inspected.stdout).toLowerCase();
      if (!/no such (?:container|object)|does not exist|no container with name or id/.test(absence)) {
        throw new Error("container daemon returned an ambiguous post-cancel inspection result.");
      }
      return { generationId, postCancelInspection: "absent" };
    });

    const generatedFixture = path.join(root, "si01-isolation-v2.pdf");
    if (!cfg.doclingFixture) {
      fs.writeFileSync(
        generatedFixture,
        simplePdf("LiOS SI-01 isolation V2 deterministic document fixture"),
        { mode: 0o600 },
      );
    }
    const doclingFixture = cfg.doclingFixture
      ? path.resolve(cfg.doclingFixture)
      : generatedFixture;
    if (!path.isAbsolute(doclingFixture)) {
      throw new Error("Docling V2 fixture must resolve to an absolute local path.");
    }

    await requiredCheck("p7_docling_real_document", async () => {
      const parsed = await parseLocalDocumentWithDoclingIsolated(doclingFixture, {
        backend,
        sandboxPythonPath: cfg.python,
      });
      if (!parsed.markdown.trim()) throw new Error("Docling returned empty markdown.");
      return {
        fixture: cfg.doclingFixture ? "operator" : "generated",
        sourceBytes: parsed.sourceBytes,
        markdownChars: parsed.markdown.length,
        warningCount: parsed.warnings.length,
      };
    });

    await requiredCheck("project_pdf_isolated_route", async () => {
      const bytes = fs.readFileSync(doclingFixture);
      const id = crypto.randomUUID();
      const reference = conversationAttachmentRefSchema.parse({
        id,
        kind: "document",
        sourceRef: `project-attachment:${id}`,
        fileName: path.basename(doclingFixture),
        mimeType: "application/pdf",
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.length,
        textPreview: null,
      });
      const resolved = await resolveConversationAttachmentContentIsolated(
        reference,
        bytes,
        { backend, sandboxPythonPath: cfg.python },
      );
      if (!resolved.textContent?.trim()) {
        throw new Error("isolated Project PDF route returned no bounded text.");
      }
      return {
        fixture: cfg.doclingFixture ? "operator" : "generated",
        sourceBytes: bytes.length,
        textChars: resolved.textContent.length,
        truncated: Boolean(resolved.textTruncation),
      };
    });

    await requiredCheck("spreadsheet_isolated_route", async () => {
      const parsed = await parseSpreadsheetArtifactImportIsolated(
        {
          bytes: Buffer.from("Name,Revenue\nAlpha,125\n", "utf8"),
          originalName: "v2-isolation.csv",
        },
        {
          backend,
          sandboxNodePath: cfg.spreadsheetNode,
          sandboxXlsxModulePath: cfg.spreadsheetXlsx,
        },
      );
      if (parsed.content.sheets[0]?.cells.B2?.raw !== "125") {
        throw new Error("isolated spreadsheet parser returned an unexpected canonical cell snapshot.");
      }
      return {
        image: cfg.image,
        sheetCount: parsed.content.sheets.length,
        inputSha256: parsed.sha256,
      };
    });

    try {
      const code = [
        'const denied = action => { try { action(); throw new Error("unexpected allow"); } catch (error) { if (error.code !== "ERR_ACCESS_DENIED") throw error; } };',
        'denied(() => require("node:fs").readFileSync("/etc/passwd"));',
        'denied(() => require("node:net").connect({ host: "127.0.0.1", port: 9 }));',
        'denied(() => require("node:child_process").spawn(process.execPath, ["-e", ""]));',
        'process.stdout.write("filesystem/network/process denied");',
      ].join("\n");
      const result = await runExecutionBackendRequest(nodePermissionExecutionBackend, {
        argv: [process.execPath, "-e", code],
        cwd: root,
        isolation: { filesystem: "none", network: "deny", processes: "deny-child-process" },
        resources: { maxWallTimeMs: 10_000, maxCapturedOutputChars: 8_192 },
      });
      if (result.exit.exitCode !== 0 || result.exit.stdout !== "filesystem/network/process denied") {
        throw new Error("Node permission denial probe did not establish all three boundaries.");
      }
      checks.push({ id: "inline-node-operation", required: false, status: "pass",
        detail: "Real inline Node filesystem, raw network and child-process denial proved through the canonical runner." });
    } catch (error) {
      checks.push({ id: "inline-node-operation", required: false, status: "fail",
        detail: error instanceof Error ? error.message : String(error) });
    }

    try {
      assertBrowserRuntimeIsolationBackend(backend);
      checks.push({
        id: "playwright_brokered_isolation",
        required: false,
        status: "fail",
        detail: "Deny-network container backend unexpectedly satisfied brokered browser egress.",
      });
    } catch (error) {
      checks.push({
        id: "playwright_brokered_isolation",
        required: false,
        status: "unavailable",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    for (const id of [
      // Inline Node is exercised above rather than inferred from the matrix.
      "managed-python-runtime-provisioning",
      "p11-lep-python-sidecar",
      "python-http-sidecar",
    ] as const) {
      const entry = SI01_ISOLATION_COVERAGE.find((candidate) => candidate.id === id);
      if (!entry) continue;
      checks.push({
        id,
        required: false,
        status: entry.state === "backend-ready" ? "fail" : "unavailable",
        detail: entry.limitation,
        evidence: { coverageState: entry.state },
      });
    }

    const evidence = buildIsolationV2Evidence({
      engine: cfg.engine,
      engineTarget: cfg.engineTarget,
      image: cfg.image,
      checks,
    });

    const serialized = JSON.stringify(evidence, null, 2) + "\n";
    process.stdout.write(serialized);
    if (cfg.evidencePath) {
      const destination = path.resolve(cfg.evidencePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, serialized, { mode: 0o600 });
    }

    assertIsolationV2Accepted(evidence);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
