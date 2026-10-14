import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as XLSX from "xlsx";
import { artifactSpreadsheetToXlsxBytes } from "../client/src/lib/spreadsheetXlsx";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { deriveSpreadsheetCellLineageStatus, SPREADSHEET_LINEAGE_APPENDIX_MARKER } from "@shared/spreadsheetCellLineage";
import { fromUniverWorkbookSnapshot, toUniverWorkbookProjection } from "@shared/univerArtifact";
import {
  parseSpreadsheetArtifactImportIsolated,
  type SpreadsheetArtifactImportInput,
} from "./spreadsheetArtifactImport";
import type { ExecutionBackend } from "./exec/backends/types";
import type { ExecutionBackendRunner } from "./exec/run-backend";

function backend(): ExecutionBackend {
  return {
    id: "test.container",
    capabilities: {
      filesystem: ["sandbox"],
      network: ["deny"],
      processes: ["sandbox"],
      resourceControls: ["wall-time", "captured-output", "memory", "process-count"],
    },
    async prepare() {
      throw new Error("injected runner owns execution");
    },
  };
}

function input(): SpreadsheetArtifactImportInput {
  return {
    bytes: Buffer.from("Name,Revenue\nAlpha,125\n", "utf8"),
    originalName: "revenue.csv",
  };
}

function successExit(stderr = "") {
  return {
    reason: "exit" as const,
    exitCode: 0,
    exitSignal: null,
    durationMs: 1,
    stdout: "",
    stderr,
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    noOutputTimedOut: false,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    sheetNames: ["Sheet1"],
    sheets: {
      Sheet1: {
        ref: "A1:B2",
        cells: {
          A1: { t: "s", v: "Name" },
          B1: { t: "s", v: "Revenue" },
          A2: { t: "s", v: "Alpha" },
          B2: { t: "n", v: 125, z: "#,##0" },
        },
      },
    },
    hasMacros: false,
    unsupportedFeatures: ["charts"],
    ...overrides,
  };
}

test("isolated spreadsheet parser keeps host paths out of argv and preserves canonical content", async () => {
  let stagingRoot = "";
  let capturedArgv: string[] = [];
  const runner: ExecutionBackendRunner = async (_backend, request) => {
    stagingRoot = request.workspaceTransfer?.root ?? "";
    capturedArgv = [...request.argv];
    assert.ok(stagingRoot);
    assert.equal(fs.existsSync(stagingRoot), true);
    assert.deepEqual(request.isolation, {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    });
    assert.equal(request.resources.maxMemoryBytes, 1024 * 1024 * 1024);
    assert.equal(request.resources.maxProcesses, 16);
    assert.deepEqual(request.workspaceTransfer?.inputs, ["input.csv"]);
    assert.deepEqual(request.workspaceTransfer?.outputs, [".lios-spreadsheet-snapshot.json"]);
    const data = Buffer.from(JSON.stringify(snapshot()), "utf8");
    return {
      backendId: "test.container",
      facts: {
        isolation: { ...request.isolation },
        resources: { ...request.resources },
      },
      exit: successExit(),
      finalization: {
        workspaceOutputs: [{
          path: ".lios-spreadsheet-snapshot.json",
          size: data.length,
          sha256: crypto.createHash("sha256").update(data).digest("hex"),
          data,
        }],
      },
    };
  };

  const parsed = await parseSpreadsheetArtifactImportIsolated(input(), {
    backend: backend(),
    runner,
  });

  assert.equal(JSON.stringify(capturedArgv).includes(stagingRoot), false);
  assert.equal(parsed.fileName, "revenue.csv");
  assert.equal(parsed.content.sheets[0]?.cells.A2?.raw, "Alpha");
  assert.equal(parsed.content.sheets[0]?.cells.B2?.raw, "125");
  assert.equal(parsed.content.sheets[0]?.cells.B2?.format, "#,##0");
  assert.deepEqual(parsed.unsupportedFeatures, ["charts"]);
  assert.equal(fs.existsSync(stagingRoot), false, "temporary spreadsheet staging is removed");
});

test("isolated spreadsheet preserves formula text from normalized snapshot", async () => {
  const runner: ExecutionBackendRunner = async (_backend, request) => {
    const value = snapshot({
      sheets: {
        Sheet1: {
          ref: "A1:C2",
          cells: {
            A1: { t: "s", v: "Revenue" },
            A2: { t: "n", v: 100 },
            B1: { t: "s", v: "Growth" },
            B2: { t: "n", v: 0.15, z: "0.00%" },
            C1: { t: "s", v: "Projected" },
            C2: { t: "n", v: 115, f: "A2*(1+B2)" },
          },
        },
      },
    });
    const data = Buffer.from(JSON.stringify(value));
    return {
      backendId: "test.container",
      facts: { isolation: { ...request.isolation }, resources: { ...request.resources } },
      exit: successExit(),
      finalization: {
        workspaceOutputs: [{
          path: ".lios-spreadsheet-snapshot.json",
          size: data.length,
          sha256: crypto.createHash("sha256").update(data).digest("hex"),
          data,
        }],
      },
    };
  };
  const parsed = await parseSpreadsheetArtifactImportIsolated(input(), { backend: backend(), runner });
  assert.equal(parsed.content.sheets[0]?.cells.C2?.raw, "=A2*(1+B2)");
  assert.equal(parsed.content.sheets[0]?.cells.B2?.format, "0.00%");
});

test("isolated spreadsheet refuses macro-bearing normalized snapshots", async () => {
  const runner: ExecutionBackendRunner = async (_backend, request) => {
    const data = Buffer.from(JSON.stringify(snapshot({ hasMacros: true })));
    return {
      backendId: "test.container",
      facts: { isolation: { ...request.isolation }, resources: { ...request.resources } },
      exit: successExit(),
      finalization: {
        workspaceOutputs: [{
          path: ".lios-spreadsheet-snapshot.json",
          size: data.length,
          sha256: crypto.createHash("sha256").update(data).digest("hex"),
          data,
        }],
      },
    };
  };
  await assert.rejects(
    () => parseSpreadsheetArtifactImportIsolated(input(), { backend: backend(), runner }),
    /Macro-enabled workbooks are not imported/,
  );
});

test("isolated spreadsheet rejects invalid snapshots and nonzero worker exits", async () => {
  const invalidRunner: ExecutionBackendRunner = async (_backend, request) => {
    const data = Buffer.from(JSON.stringify({ sheetNames: ["Sheet1"] }));
    return {
      backendId: "test.container",
      facts: { isolation: { ...request.isolation }, resources: { ...request.resources } },
      exit: successExit(),
      finalization: {
        workspaceOutputs: [{
          path: ".lios-spreadsheet-snapshot.json",
          size: data.length,
          sha256: crypto.createHash("sha256").update(data).digest("hex"),
          data,
        }],
      },
    };
  };
  await assert.rejects(
    () => parseSpreadsheetArtifactImportIsolated(input(), { backend: backend(), runner: invalidRunner }),
    /invalid normalized snapshot/,
  );

  const failedRunner: ExecutionBackendRunner = async (_backend, request) => ({
    backendId: "test.container",
    facts: { isolation: { ...request.isolation }, resources: { ...request.resources } },
    exit: { ...successExit("parser failed"), exitCode: 9 },
    finalization: {},
  });
  await assert.rejects(
    () => parseSpreadsheetArtifactImportIsolated(input(), { backend: backend(), runner: failedRunner }),
    /Isolated spreadsheet parser failed: parser failed/,
  );
});

test("isolated spreadsheet validates the in-image Node path before creating staging", async () => {
  let called = false;
  const runner: ExecutionBackendRunner = async () => {
    called = true;
    throw new Error("must not run");
  };
  await assert.rejects(
    () => parseSpreadsheetArtifactImportIsolated(input(), {
      backend: backend(),
      sandboxNodePath: "node",
      runner,
    }),
    /Node path must be an absolute NUL-free path/,
  );
  await assert.rejects(
    () => parseSpreadsheetArtifactImportIsolated(input(), {
      backend: backend(),
      sandboxXlsxModulePath: "xlsx",
      runner,
    }),
    /SheetJS module path must be an absolute NUL-free path/,
  );
  assert.equal(called, false);
});

test("actual isolated worker script parses real named XLSX bytes before bounded snapshot canonical reopen", async () => {
  const source = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", rendererPreference: "univer", activeSheetId: "inputs", calculationMode: "manual",
    sheets: [
      { id: "model", name: "Owner's Model", rowCount: 10, columnCount: 4, names: { Revenue: "A2", Growth: "B2" },
        cells: { A2: { raw: "100", format: "0.00" }, B2: { raw: "0.15", format: "0.0%" }, C2: { raw: "=Revenue*(1+Growth)", format: "0.00" } } },
      { id: "inputs", name: "Inputs", rowCount: 10, columnCount: 4, names: { Revenue: "B2" },
        cells: { A2: { raw: "12345678901234567890.123456789", format: "@" }, B2: { raw: "20", format: null } } },
    ],
  });
  const bytes = Buffer.from(artifactSpreadsheetToXlsxBytes(source));
  const donor = XLSX.read(bytes, { type: "buffer", cellFormula: true, cellNF: true });
  assert.equal(donor.Workbook?.Names?.length, 3);
  assert.equal(donor.Sheets.Inputs.A2.t, "s");
  assert.equal(donor.Sheets.Inputs.A2.v, source.sheets[1].cells.A2.raw);
  let normalized: Record<string, unknown> | undefined;
  // Host subprocess runs the exact generated worker: this proves serialization, not sandbox enforcement.
  const runner: ExecutionBackendRunner = async (_backend, request) => {
    const root = request.workspaceTransfer!.root;
    const outputName = request.workspaceTransfer!.outputs[0];
    execFileSync(process.execPath, [
      "-e", request.argv[2], path.join(root, request.workspaceTransfer!.inputs[0]), path.join(root, outputName),
      request.argv[5], createRequire(import.meta.url).resolve("xlsx"),
    ], { timeout: request.resources.maxWallTimeMs, maxBuffer: 1024 * 1024 });
    const data = fs.readFileSync(path.join(root, outputName));
    normalized = JSON.parse(data.toString("utf8"));
    return {
      backendId: "test.worker-serialization",
      facts: { isolation: { ...request.isolation }, resources: { ...request.resources } },
      exit: successExit(),
      finalization: { workspaceOutputs: [{ path: outputName, size: data.length,
        sha256: crypto.createHash("sha256").update(data).digest("hex"), data }] },
    };
  };
  const parsed = await parseSpreadsheetArtifactImportIsolated({ bytes, originalName: "named.xlsx" }, { backend: backend(), runner });
  assert.equal((normalized?.definedNames as unknown[]).length, 3);
  assert.deepEqual(parsed.content.sheets.map((sheet) => sheet.names), source.sheets.map((sheet) => sheet.names));
  assert.equal(parsed.content.activeSheetId, "sheet-2");
  assert.equal(parsed.content.calculationMode, "manual");
  assert.equal(parsed.content.sheets[0].cells.C2.raw, "=Revenue*(1+Growth)");
  assert.equal(parsed.content.sheets[1].cells.A2.raw, source.sheets[1].cells.A2.raw);
  const projection = toUniverWorkbookProjection(parsed.content);
  assert.equal(projection.sheets["sheet-2"].cellData?.[1]?.[0]?.v, source.sheets[1].cells.A2.raw);
  assert.deepEqual(fromUniverWorkbookSnapshot(projection, parsed.content, parsed.content.activeSheetId), parsed.content);
});

test("actual bounded SheetJS worker retains long visible lineage but returns only unverified historical custody", async () => {
  const source = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", activeSheetId: "model", calculationMode: "manual",
    sheets: [{ id: "model", name: "Model", rowCount: 2, columnCount: 2, cells: {
      A1: { raw: "120", format: "#,##0", lineage: {
        kind: "reported_actual", custody: "server_projection", capturedRaw: "100", capturedFormat: "#,##0",
        datasetSnapshotId: "12345678-1234-4123-8123-123456789012", contentHash: "a".repeat(64),
        statement: "income_statement", canonicalKey: "revenue", sourcePath: "/statements/FY2025/revenue",
        period: "FY2025", sourceRefs: ["citation:annual", "receipt:dataset"],
      } },
      B2: { raw: "=A1*2", format: "0.00", lineage: {
        kind: "engine_output", custody: "server_projection", capturedRaw: `${"x".repeat(31_998)}😀${"y".repeat(40_000)}`,
        capturedFormat: "0.00", modelRunId: "12345678-1234-4123-8123-123456789013", resultHash: "b".repeat(64),
        resultPath: "/model/output", period: "FY2026", sourceRefs: ["receipt:run", "=untrusted-ref"],
      } },
    } }],
  });
  const bytes = Buffer.from(artifactSpreadsheetToXlsxBytes(source));
  // This executes the exact generated parser in a host subprocess, not a claim
  // of native sandbox enforcement. Production still uses the governed backend.
  const runner: ExecutionBackendRunner = async (_backend, request) => {
    const root = request.workspaceTransfer!.root;
    const outputName = request.workspaceTransfer!.outputs[0];
    assert.equal(request.workspaceTransfer!.maxFileBytes, 64 * 1024 * 1024);
    execFileSync(process.execPath, [
      "-e", request.argv[2], path.join(root, request.workspaceTransfer!.inputs[0]), path.join(root, outputName),
      request.argv[5], createRequire(import.meta.url).resolve("xlsx"),
    ], { timeout: request.resources.maxWallTimeMs, maxBuffer: 1024 * 1024 });
    const data = fs.readFileSync(path.join(root, outputName));
    return {
      backendId: "test.worker-serialization",
      facts: { isolation: { ...request.isolation }, resources: { ...request.resources } },
      exit: successExit(),
      finalization: { workspaceOutputs: [{ path: outputName, size: data.length,
        sha256: crypto.createHash("sha256").update(data).digest("hex"), data }] },
    };
  };
  const parsed = await parseSpreadsheetArtifactImportIsolated({ bytes, originalName: "lineage.xlsx" }, { backend: backend(), runner });
  assert.equal(parsed.content.sheets[0].cells.B2.raw, "=A1*2");
  assert.equal(parsed.content.sheets[0].cells.B2.format, "0.00");
  for (const ref of ["A1", "B2"]) {
    const cell = parsed.content.sheets[0].cells[ref];
    assert.deepEqual(cell.lineage, { ...source.sheets[0].cells[ref].lineage, custody: "imported_history" });
    assert.equal(deriveSpreadsheetCellLineageStatus(cell), "edited_unverified");
  }
  const appendix = parsed.content.sheets.find((sheet) => sheet.name === "__LiOS Provenance");
  assert.ok(appendix);
  assert.ok(Object.values(appendix.cells).some((cell) => cell.raw === SPREADSHEET_LINEAGE_APPENDIX_MARKER));
  assert.equal(appendix.cells.A1.raw, "LiOS P4 spreadsheet metadata");
  // P4 deliberately exports formulas without cached results. SheetJS requires
  // sheetStubs to expose these value-less cells, as in the governed worker.
  const reexported = XLSX.read(artifactSpreadsheetToXlsxBytes(parsed.content), {
    type: "array", cellFormula: true, cellNF: true, sheetStubs: true,
  });
  assert.equal(reexported.Sheets.Model.B2.f, "A1*2");
  assert.equal(reexported.Sheets.Model.B2.z, "0.00");
  assert.equal(reexported.Sheets.Model.A1.v, 120);
  assert.ok(reexported.SheetNames.includes("__LiOS Provenance (2)"), "reexport never overwrites the imported visible appendix");
});
