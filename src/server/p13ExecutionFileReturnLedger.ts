import crypto from "node:crypto";
import type { P13StagedFileReturn } from "./p13PluginWriteReturn";

/**
 * GM-11 / P13 host-memory-only return ledger. One active LEP execution owns
 * each entry. No Project persistence, grant issuance or plugin activation.
 */
export const P13_RETURN_LIMITS = Object.freeze({
  maxExecutions: 16,
  maxFilesPerExecution: 4,
  maxBytesPerFile: 1024 * 1024,
  maxBytesPerExecution: 2 * 1024 * 1024,
  maxBytesAcrossExecutions: 8 * 1024 * 1024,
});

interface ActiveReturn {
  readonly componentId: string;
  readonly files: Map<string, P13StagedFileReturn>;
  bytes: number;
}

function fileKey(file: Pick<P13StagedFileReturn,"scope"|"rootIndex"|"relativePath">): string {
  return JSON.stringify([file.scope,file.rootIndex,file.relativePath]);
}

function clearBytes(file: P13StagedFileReturn): void {
  file.data.fill(0);
}

export class P13ExecutionFileReturnLedger {
  private readonly executions = new Map<string, ActiveReturn>();
  private totalBytes = 0;

  begin(executionRequestId: string, componentId: string): void {
    if (!executionRequestId || !componentId || this.executions.has(executionRequestId) ||
        this.executions.size >= P13_RETURN_LIMITS.maxExecutions) {
      throw new Error("filesystem_return_execution_unavailable");
    }
    this.executions.set(executionRequestId, {componentId,files:new Map(),bytes:0});
  }

  stage(file: P13StagedFileReturn): void {
    const session = this.executions.get(file.executionRequestId);
    if (!session || session.componentId !== file.componentId) {
      throw new Error("filesystem_return_execution_revoked");
    }
    const key = fileKey(file);
    const data = file.data;
    if (session.files.has(key)) throw new Error("filesystem_return_duplicate_output");
    if (!Buffer.isBuffer(data) || file.size !== data.length ||
        !Number.isSafeInteger(file.size) || file.size < 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        crypto.createHash("sha256").update(data).digest("hex") !== file.sha256) {
      throw new Error("filesystem_return_integrity_invalid");
    }
    if (file.size > P13_RETURN_LIMITS.maxBytesPerFile ||
        session.files.size >= P13_RETURN_LIMITS.maxFilesPerExecution ||
        session.bytes + file.size > P13_RETURN_LIMITS.maxBytesPerExecution ||
        this.totalBytes + file.size > P13_RETURN_LIMITS.maxBytesAcrossExecutions) {
      throw new Error("filesystem_return_budget_exceeded");
    }
    const copied = Object.freeze({...file,data:Buffer.from(data)});
    session.files.set(key,copied);
    session.bytes += file.size;
    this.totalBytes += file.size;
  }

  /** Call strictly AFTER a successful LEP result, never during auxiliary IO.
   * The output buffers are copied for the owner. Any unclaimed data is erased.
   */
  complete(executionRequestId: string): readonly P13StagedFileReturn[] {
    const session = this.executions.get(executionRequestId);
    if (!session) throw new Error("filesystem_return_execution_revoked");
    const safeCopies = [...session.files.values()].map(file =>
      Object.freeze({...file,data:Buffer.from(file.data)}));
    this.revoke(executionRequestId);
    return Object.freeze(safeCopies);
  }

  /** Cancellation, failed execution, timeout and disposal discard all bytes. */
  revoke(executionRequestId: string): void {
    const session = this.executions.get(executionRequestId);
    if (!session) return;
    this.executions.delete(executionRequestId);
    this.totalBytes -= session.bytes;
    for (const file of session.files.values()) clearBytes(file);
    session.files.clear();
  }

  dispose(): void {
    for (const id of [...this.executions.keys()]) this.revoke(id);
  }

  /** Only trust-safe operational counts, never host paths or data. */
  facts(): Readonly<{activeExecutions:number;storedFiles:number;storedBytes:number}> {
    return Object.freeze({
      activeExecutions:this.executions.size,
      storedFiles:[...this.executions.values()].reduce((count,session)=>count+session.files.size,0),
      storedBytes:this.totalBytes,
    });
  }
}
