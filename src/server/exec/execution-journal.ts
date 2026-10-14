import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataPath } from "../dataRoot";
import {
  MAX_AGENT_CHECKPOINT_BYTES,
  MAX_AGENT_CONTINUATION_BYTES,
  agentCheckpointSnapshotSchema,
  assertAgentCheckpointStoredFor,
  parseAgentCheckpointSnapshot,
  type AgentCheckpointSnapshot,
} from "../agent-checkpoint";
import {
  EncryptedStorageProvider,
  FilesystemStorageProvider,
  StorageIntegrityError,
  StorageNotFoundError,
  loadOrCreateStorageKey,
} from "../storageProvider";
import { surrogateSafeTail } from "./output-ring";
import {
  AGENT_EVENT_LIMIT,
  AgentLedgerError,
  agentEventSchema,
  assertAgentEventChain,
  foldAgentToolDispatchState,
  hasCallWaitingApproval, waitingCallId,
  sealAgentEvent,
  type AgentRunEvent,
} from "./agent-run-events";
export class ExecutionJournalRunIdConflictError extends StorageIntegrityError {
  constructor() {
    super("Execution journal id already exists.");
    this.name = "ExecutionJournalRunIdConflictError";
  }
}

/**
 * GM-10b persistence boundary, not a process/session owner. Donor-first: reuses
 * OpenClaw's surrogateSafeTail (MIT, Copyright (c) 2026 OpenClaw Foundation),
 * commit c074824a27c96d3983043f9eeb33823cd1772d8c,
 * upstream src/gateway/terminal/output-ring.ts, via the existing LiOS import.
 * The donor session manager's volatile replay map is not durable encrypted
 * storage; canonical LiOS storage provides encryption, key authority and atomic
 * writes instead. Recovery only records interruption; it never starts a process.
 *
 * GM-11d trust facts extend this same encrypted record. They are deliberately
 * secret-safe hashes/ids and policy outcomes, not argv, environment, stdin,
 * credentials or a second receipt database.
 */
export interface ExecutionOwner {
  userId: number;
  projectId: number | null;
  chatId: number | null;
}

export type ExecutionTrustDenialReason =
  | "user-denied"
  | "policy-denied"
  | "stale-policy"
  | "expired"
  | "cancelled-before-launch"
  | "unsupported"
  | "approval-mismatch";

export interface ExecutionTrustFacts {
  version: 1;
  /** Canonical conversation/runtime request UUID. */
  requestId: string;
  /** Exact GM-11 operation identity digest; null only when denial happened before operation identity existed. */
  operationDigest: string | null;
  /** Secret-safe digest binding operation + backend/isolation/resource/control facts; null only for pre-admission denial. */
  approvalDigest: string | null;
  permissionClass: "user_confirm" | "admin_confirm";
  /** Opaque SHA-256 revision from the canonical policy owner. */
  policyRevision: string;
  decision: "approved" | "denied";
  denialReason: ExecutionTrustDenialReason | null;
  /** Canonical execution backend id. Required for approved execution, null is allowed for pre-admission denial. */
  backendId: string | null;
  /** Optional opaque device identity; never a secret or credential. */
  deviceId: string | null;
  /** Optional backend-owned generation/session id used for extinction/cleanup evidence. */
  backendGenerationId: string | null;
  /** Optional link to the generic RuntimeExecutionReceipt when one exists. */
  runtimeReceiptId: string | null;
  /** Hashes of independently revalidated safe-console input; raw input is never retained. */
  interactiveInputDigests?: string[];
}

export interface ExecutionJournalRecord {
  /** 1 = GM-10/GM-11 record. 2 = agent run: the same record plus an append-only, bounded `events` ledger (SI-02 L2). */
  version: 1 | 2;
  id: string;
  owner: ExecutionOwner;
  /** Caller-supplied display label, never the raw command, argv or environment. */
  label: string;
  /** `waiting_approval` is a durable, non-terminal pause of a version-2 agent run; only an explicit resume continues it. */
  status: "running" | "waiting_approval" | "completed" | "cancelled" | "failed" | "interrupted" | "denied";
  startedAt: string;
  endedAt: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Null keeps old GM-10 journal records valid; new privileged runs carry GM-11d facts. */
  trust: ExecutionTrustFacts | null;
  /** Present on version-2 records only; version-1 records are read as stored and never rewritten to add it. */
  events?: AgentRunEvent[];
  /** Optional L6 structured checkpoint on the same encrypted v2 record. */
  checkpoint?: AgentCheckpointSnapshot;
}

export interface ExecutionJournalOptions {
  directory?: string;
  keyDirectory?: string;
  /** Combined stdout/stderr UTF-16 character budget; newest output wins. */
  maxTranscriptChars?: number;
  /** Running records are never evicted to make room for another execution. */
  maxRecords?: number;
}

const DEFAULT_TRANSCRIPT_CHARS = 256 * 1024;
const DEFAULT_MAX_RECORDS = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ownerSchema = z.object({
  userId: z.number().int().positive().safe(),
  projectId: z.number().int().positive().safe().nullable(),
  chatId: z.number().int().positive().safe().nullable(),
}).strict();
const trustFactsSchema = z.object({
  version: z.literal(1),
  requestId: z.string().regex(UUID),
  operationDigest: z.string().regex(SHA256).nullable(),
  approvalDigest: z.string().regex(SHA256).nullable(),
  permissionClass: z.enum(["user_confirm", "admin_confirm"]),
  policyRevision: z.string().regex(SHA256),
  decision: z.enum(["approved", "denied"]),
  denialReason: z.enum([
    "user-denied",
    "policy-denied",
    "stale-policy",
    "expired",
    "cancelled-before-launch",
    "unsupported",
    "approval-mismatch",
  ]).nullable(),
  backendId: z.string().regex(OPAQUE_ID).nullable(),
  deviceId: z.string().regex(OPAQUE_ID).nullable(),
  backendGenerationId: z.string().regex(OPAQUE_ID).nullable(),
  runtimeReceiptId: z.string().regex(UUID).nullable(),
  interactiveInputDigests: z.array(z.string().regex(SHA256)).max(256).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "approved") {
    if (value.denialReason !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["denialReason"], message: "Approved trust facts cannot carry a denial reason." });
    }
    if (value.backendId === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backendId"], message: "Approved trust facts require a backend id." });
    }
    if (value.operationDigest === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operationDigest"], message: "Approved trust facts require an exact operation digest." });
    }
    if (value.approvalDigest === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["approvalDigest"], message: "Approved trust facts require the approved admission digest." });
    }
  } else {
    if (value.denialReason === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["denialReason"], message: "Denied trust facts require a denial reason." });
    }
    if (value.runtimeReceiptId !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtimeReceiptId"], message: "Denied trust facts cannot link a runtime result receipt." });
    }
    if (value.approvalDigest !== null && (value.operationDigest === null || value.backendId === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["approvalDigest"], message: "A denied approved-admission digest requires operation and backend identity." });
    }
  }
  if (value.backendGenerationId !== null && value.backendId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backendGenerationId"], message: "Backend generation identity requires a backend id." });
  }
});
const recordSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(UUID),
  owner: ownerSchema,
  label: z.string().max(256),
  status: z.enum(["running", "waiting_approval", "completed", "cancelled", "failed", "interrupted", "denied"]),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().safe().nullable(),
  trust: trustFactsSchema.nullable().default(null),
}).strict();
const recordV2Schema = recordSchema.extend({
  version: z.literal(2),
  events: z.array(agentEventSchema).max(AGENT_EVENT_LIMIT),
  checkpoint: agentCheckpointSnapshotSchema.optional(),
});

function assertId(id: string): void {
  if (!UUID.test(id)) throw new StorageIntegrityError("Execution journal id must be a lowercase UUID.");
}

function validLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new StorageIntegrityError("Execution journal limit is invalid.");
  }
  return value;
}

function parseTrustFacts(value: ExecutionTrustFacts | null | undefined): ExecutionTrustFacts | null {
  if (value == null) return null;
  const parsed = trustFactsSchema.safeParse(value);
  if (!parsed.success) throw new StorageIntegrityError("Execution trust facts are invalid.");
  return parsed.data;
}

// Match LiOS's factorRiskSnapshotStore and p11SidecarSupervisor guard patterns.
// This is best-effort defense in depth, not a substitute for authenticated encryption.
function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|token|secret|password|authorization)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, "$1[REDACTED]");
}

function tail(value: string, cap: number): string {
  return value.length <= cap ? value : surrogateSafeTail(value, cap);
}

async function prepareDirectory(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new StorageIntegrityError("Execution journal directory must not be a symbolic link.");
  }
  if (process.platform !== "win32") await fs.chmod(directory, 0o700);
  return fs.realpath(directory);
}

/** All operations on one journal are serialized, including reads and recovery. */
export class ExecutionJournal {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly directory: string,
    private readonly provider: EncryptedStorageProvider,
    private readonly maxTranscriptChars: number,
    private readonly maxRecords: number,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // Propagate this operation's error to its caller without poisoning later work.
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async assertDirectory(): Promise<void> {
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(this.directory) !== this.directory) {
      throw new StorageIntegrityError("Execution journal directory was replaced or linked.");
    }
  }

  private async load(id: string): Promise<ExecutionJournalRecord | null> {
    assertId(id);
    await this.assertDirectory();
    const filename = path.join(this.directory, id);
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new StorageIntegrityError("Execution journal records must be regular files, never links.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let bytes: Buffer;
    try {
      bytes = await this.provider.get(id, { maxBytes: DEFAULT_TRANSCRIPT_CHARS * 6 + 8192 + AGENT_EVENT_LIMIT * 1024 + MAX_AGENT_CHECKPOINT_BYTES + MAX_AGENT_CONTINUATION_BYTES });
    } catch (error) {
      if (error instanceof StorageNotFoundError) return null;
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new StorageIntegrityError("Execution journal record contains invalid JSON.");
    }
    const isV2 = typeof raw === "object" && raw !== null && (raw as { version?: unknown }).version === 2;
    const parsed = isV2 ? recordV2Schema.safeParse(raw) : recordSchema.safeParse(raw);
    if (!parsed.success) throw new StorageIntegrityError("Execution journal record has an invalid schema.");
    const record: ExecutionJournalRecord = parsed.data as ExecutionJournalRecord;
    if (record.events) {
      try {
        assertAgentEventChain(record.events, record.id);
      } catch (error) {
        if (error instanceof AgentLedgerError) throw new StorageIntegrityError("Execution journal record has an inconsistent agent ledger.");
        throw error;
      }
    }
    if (record.checkpoint) {
      try {
        record.checkpoint = assertAgentCheckpointStoredFor({
          snapshot: parseAgentCheckpointSnapshot(record.checkpoint),
          requestId: record.id,
          owner: record.owner,
        });
      } catch {
        throw new StorageIntegrityError("Execution journal record has an invalid agent checkpoint.");
      }
    }
    const isOpen = record.status === "running" || record.status === "waiting_approval";
    const isTerminal = !isOpen;
    const inconsistentWaiting = record.status === "waiting_approval"
      && (record.version !== 2 || !record.events || !hasCallWaitingApproval(record.events));
    const inconsistentDenied = record.status === "denied" && (
      record.exitCode !== null || record.stdout !== "" || record.stderr !== "" || record.trust?.decision !== "denied"
    );
    const inconsistentTrustLifecycle =
      (record.status === "denied" && record.trust?.decision !== "denied")
      || (record.status !== "denied" && record.trust?.decision === "denied");
    if (record.id !== id || record.stdout.length + record.stderr.length > DEFAULT_TRANSCRIPT_CHARS ||
        (isOpen && (record.endedAt !== null || record.exitCode !== null)) || inconsistentWaiting ||
        (isTerminal && (record.endedAt === null || record.endedAt < record.startedAt)) ||
        (record.status === "interrupted" && record.exitCode !== null) || inconsistentDenied || inconsistentTrustLifecycle) {
      throw new StorageIntegrityError("Execution journal record has inconsistent state.");
    }
    return record;
  }

  private async discover(): Promise<ExecutionJournalRecord[]> {
    await this.assertDirectory();
    const records: ExecutionJournalRecord[] = [];
    // No volatile index: restart/restore discovers the actual UUID objects.
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!UUID.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new StorageIntegrityError("Execution journal records must be regular files, never links.");
      }
      const record = await this.load(entry.name);
      if (record) records.push(record);
    }
    return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  }

  private async save(record: ExecutionJournalRecord): Promise<void> {
    await this.assertDirectory();
    // Preserve the legacy encrypted-record shape when no GM-11 trust facts exist.
    // recordSchema restores trust:null on read, so old/new callers see one API.
    const serialized = record.version === 1 && record.trust === null
      ? (({ trust: _trust, ...legacyRecord }) => legacyRecord)(record)
      : record;
    await this.provider.put(record.id, Buffer.from(JSON.stringify(serialized)));
  }

  private async admitId(id: string): Promise<void> {
    const records = await this.discover();
    if (records.some((record) => record.id === id)) throw new ExecutionJournalRunIdConflictError();
    const excess = records.length - this.maxRecords + 1;
    // Running records and durable approval pauses are never evicted to make room.
    const removable = records.filter((record) => record.status !== "running" && record.status !== "waiting_approval");
    if (excess > removable.length) throw new StorageIntegrityError("Execution journal is full of running records.");
    for (const record of removable.slice(0, Math.max(0, excess))) await this.provider.delete(record.id);
  }

  begin(input: { id: string; owner: ExecutionOwner; label: string; trust?: ExecutionTrustFacts | null; agentRun?: boolean }): Promise<void> {
    // Snapshot input before queueing; caller mutation cannot change ownership/trust evidence.
    const id = input.id;
    const owner = { ...input.owner };
    const label = input.label;
    const trust = parseTrustFacts(input.trust);
    const agentRun = input.agentRun === true;
    return this.serialize(async () => {
      assertId(id);
      if (!ownerSchema.safeParse(owner).success || typeof label !== "string") {
        throw new StorageIntegrityError("Execution journal owner or label is invalid.");
      }
      if (trust?.decision === "denied") {
        throw new StorageIntegrityError("Execution trust facts are invalid for a running execution.");
      }
      await this.admitId(id);
      await this.save({
        version: agentRun ? 2 : 1, id, owner, label: tail(redactText(label), 256), status: "running",
        startedAt: new Date().toISOString(), endedAt: null, stdout: "", stderr: "", exitCode: null, trust,
        ...(agentRun ? { events: [] } : {}),
      });
    });
  }

  recordDenied(input: { id: string; owner: ExecutionOwner; label: string; trust: ExecutionTrustFacts }): Promise<void> {
    const id = input.id;
    const owner = { ...input.owner };
    const label = input.label;
    const trust = parseTrustFacts(input.trust);
    return this.serialize(async () => {
      assertId(id);
      if (!ownerSchema.safeParse(owner).success || typeof label !== "string" || trust?.decision !== "denied") {
        throw new StorageIntegrityError("Execution trust facts are invalid for denied execution.");
      }
      await this.admitId(id);
      const now = new Date().toISOString();
      await this.save({
        version: 1,
        id,
        owner,
        label: tail(redactText(label), 256),
        status: "denied",
        startedAt: now,
        endedAt: now,
        stdout: "",
        stderr: "",
        exitCode: null,
        trust,
      });
    });
  }

  append(id: string, stream: "stdout" | "stderr", chunk: string): Promise<void> {
    return this.serialize(async () => {
      if ((stream !== "stdout" && stream !== "stderr") || typeof chunk !== "string") {
        throw new StorageIntegrityError("Execution journal output is invalid.");
      }
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (record.status !== "running") throw new StorageIntegrityError("Execution journal record is already finalized.");
      const other = stream === "stdout" ? "stderr" : "stdout";
      record[stream] = tail(redactText(record[stream] + chunk), this.maxTranscriptChars);
      record[other] = tail(record[other], this.maxTranscriptChars - record[stream].length);
      await this.save(record);
    });
  }
  /**
   * Appends one validated agent event (SI-02 L2). Sequence and time are assigned here; the caller supplies ids, hashes and
   * opaque references only. Refused after the run is terminal, for non-agent records, for a reused tool-call id, and for any
   * second terminal state of a step or tool call. A failed append fails the caller visibly; there is no memory fallback.
   */
  appendAgentEvent(id: string, event: unknown): Promise<AgentRunEvent> {
    return this.serialize(async () => {
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (record.status === "waiting_approval") throw new StorageIntegrityError("Execution is waiting for approval; resume it before appending.");
      if (record.status !== "running") throw new StorageIntegrityError("Execution journal record is already finalized.");
      if (record.version !== 2 || !record.events) throw new StorageIntegrityError("Execution journal record is not an agent run.");
      if (typeof event === "object" && event !== null && (event as { kind?: unknown }).kind === "tool_call_resumed") {
        throw new StorageIntegrityError("Approval release is one atomic transition; use resumeAfterApproval.");
      }
      let sealed: AgentRunEvent;
      try {
        // Never earlier than the previous event, so a clock step backwards cannot make the stored chain unreadable.
        const floor = Math.max(Date.now(), Date.parse(record.startedAt), Date.parse(record.events.at(-1)?.at ?? record.startedAt));
        sealed = sealAgentEvent(record.events, event, new Date(floor).toISOString(), record.id);
      } catch (error) {
        if (error instanceof AgentLedgerError) throw new StorageIntegrityError(error.message);
        throw error;
      }
      record.events = [...record.events, sealed];
      await this.save(record);
      return sealed;
    });
  }

  /**
   * Durably pauses an agent run whose ledger has a tool call waiting for approval (SI-02 L2/L4). The record is open, not
   * terminal: nothing executes and only `resumeAfterApproval` continues it within this process. A restart marks it
   * interrupted (see recoverInterrupted); it is never resumed across a restart.
   */
  markWaitingApproval(id: string): Promise<void> {
    return this.serialize(async () => {
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (record.status !== "running") throw new StorageIntegrityError("Only a running execution can wait for approval.");
      if (record.version !== 2 || !record.events || !hasCallWaitingApproval(record.events)) {
        throw new StorageIntegrityError("Execution has no tool call waiting for approval.");
      }
      record.status = "waiting_approval";
      await this.save(record);
    });
  }

  /**
   * Persists one owner-bound L6 checkpoint on the same encrypted agent record.
   * This stores data only: it never resumes, executes, approves, or reopens a run.
   */
  writeAgentCheckpoint(id: string, owner: ExecutionOwner, checkpoint: AgentCheckpointSnapshot): Promise<void> {
    const requestedOwner = { ...owner };
    const checkpointCopy = JSON.parse(JSON.stringify(checkpoint)) as unknown;
    return this.serialize(async () => {
      if (!ownerSchema.safeParse(requestedOwner).success) {
        throw new StorageIntegrityError("Execution journal owner is invalid.");
      }
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (
        record.owner.userId !== requestedOwner.userId ||
        record.owner.projectId !== requestedOwner.projectId ||
        record.owner.chatId !== requestedOwner.chatId
      ) {
        throw new StorageNotFoundError();
      }
      if (record.version !== 2 || !record.events) {
        throw new StorageIntegrityError("Agent checkpoints require a version-2 agent run.");
      }
      if (record.status !== "running" && record.status !== "waiting_approval") {
        throw new StorageIntegrityError("Agent checkpoint can only be written while the run is active.");
      }
      try {
        record.checkpoint = assertAgentCheckpointStoredFor({
          snapshot: parseAgentCheckpointSnapshot(checkpointCopy),
          requestId: record.id,
          owner: record.owner,
        });
      } catch {
        throw new StorageIntegrityError("Agent checkpoint does not match this execution.");
      }
      await this.save(record);
    });
  }

  /**
   * Remove any stale restart checkpoint from an active owner-bound agent record
   * without changing the live run or sealed event ledger. Failure must be visible.
   */
  clearAgentCheckpoint(id: string, owner: ExecutionOwner): Promise<void> {
    const requestedOwner = { ...owner };
    return this.serialize(async () => {
      if (!ownerSchema.safeParse(requestedOwner).success) {
        throw new StorageIntegrityError("Execution journal owner is invalid.");
      }
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (
        record.owner.userId !== requestedOwner.userId ||
        record.owner.projectId !== requestedOwner.projectId ||
        record.owner.chatId !== requestedOwner.chatId
      ) {
        throw new StorageNotFoundError();
      }
      if (record.version !== 2 || !record.events) {
        throw new StorageIntegrityError("Agent checkpoints require a version-2 agent run.");
      }
      if (record.status !== "running" && record.status !== "waiting_approval") {
        throw new StorageIntegrityError("Agent checkpoint can only be cleared while the run is active.");
      }
      delete record.checkpoint;
      await this.save(record);
    });
  }

  /** Owner-scoped checkpoint read. Reading never executes or changes run state. */
  readAgentCheckpoint(id: string, owner: ExecutionOwner): Promise<AgentCheckpointSnapshot | null> {
    const requestedOwner = { ...owner };
    return this.serialize(async () => {
      if (!ownerSchema.safeParse(requestedOwner).success) {
        throw new StorageIntegrityError("Execution journal owner is invalid.");
      }
      const record = await this.load(id);
      if (
        !record ||
        record.owner.userId !== requestedOwner.userId ||
        record.owner.projectId !== requestedOwner.projectId ||
        record.owner.chatId !== requestedOwner.chatId
      ) {
        return null;
      }
      return record.checkpoint ? parseAgentCheckpointSnapshot(record.checkpoint) : null;
    });
  }

  /**
   * Explicit, owner-checked release of a paused run, as ONE serialized save: the `tool_call_resumed` event (with the opaque
   * `approvalRef`, audit evidence only) for the expected waiting call is appended and the status flips to running together, so a crash can never leave a
   * running record whose ledger still says the call is waiting. This is the only producer of `tool_call_resumed`. The
   * approval itself is minted and live-revalidated by the caller (L4) before this is called; no approval is persisted.
   */
  resumeAfterApproval(id: string, owner: ExecutionOwner, expectedToolCallId: string, approvalRef: string): Promise<AgentRunEvent> {
    const requestedOwner = { ...owner };
    return this.serialize(async () => {
      if (!ownerSchema.safeParse(requestedOwner).success) throw new StorageIntegrityError("Execution journal owner is invalid.");
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (record.owner.userId !== requestedOwner.userId || record.owner.projectId !== requestedOwner.projectId || record.owner.chatId !== requestedOwner.chatId) {
        throw new StorageNotFoundError();
      }
      if (record.status !== "waiting_approval") throw new StorageIntegrityError("Execution is not waiting for approval.");
      if (record.version !== 2 || !record.events) throw new StorageIntegrityError("Execution journal record is not an agent run.");
      const toolCallId = waitingCallId(record.events);
      if (!toolCallId) throw new StorageIntegrityError("Execution has no single tool call waiting for approval.");
      // Fail closed before any change: the call L4 bound its approval to must be exactly the call that is waiting.
      if (toolCallId !== expectedToolCallId) throw new StorageIntegrityError("The waiting tool call is not the one the approval was bound to.");
      let sealed: AgentRunEvent;
      try {
        const floor = Math.max(Date.now(), Date.parse(record.startedAt), Date.parse(record.events.at(-1)?.at ?? record.startedAt));
        sealed = sealAgentEvent(record.events, { kind: "tool_call_resumed", toolCallId, approvalRef }, new Date(floor).toISOString(), record.id);
      } catch (error) {
        if (error instanceof AgentLedgerError) throw new StorageIntegrityError(error.message);
        throw error;
      }
      record.events = [...record.events, sealed];
      record.status = "running";
      await this.save(record);
      return sealed;
    });
  }

  /**
   * L6 explicit resume transition. The caller must first revalidate the persisted
   * checkpoint against current owner/plan/tool/policy/context/adapter facts.
   * This method rechecks the exact binding and only reopens the durable record;
   * it never invokes an adapter or executes a tool.
   */
  resumeInterruptedAgentCheckpoint(
    id: string,
    owner: ExecutionOwner,
    expectedBindingSha256: string,
  ): Promise<AgentCheckpointSnapshot> {
    const requestedOwner = { ...owner };
    return this.serialize(async () => {
      if (!ownerSchema.safeParse(requestedOwner).success || !SHA256.test(expectedBindingSha256)) {
        throw new StorageIntegrityError("Agent checkpoint resume binding is invalid.");
      }
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (
        record.owner.userId !== requestedOwner.userId ||
        record.owner.projectId !== requestedOwner.projectId ||
        record.owner.chatId !== requestedOwner.chatId
      ) {
        throw new StorageNotFoundError();
      }
      if (record.status !== "interrupted") {
        throw new StorageIntegrityError("Only an interrupted agent execution can resume from checkpoint.");
      }
      if (record.version !== 2 || !record.events || !record.checkpoint) {
        throw new StorageIntegrityError("Interrupted execution has no durable agent checkpoint.");
      }
      if (foldAgentToolDispatchState(record.events, record.id).some((dispatch) => dispatch.status === "outcome_unknown")) {
        throw new StorageIntegrityError("Outcome-unknown agent dispatch must be reconciled before checkpoint resume.");
      }
      const checkpoint = assertAgentCheckpointStoredFor({
        snapshot: record.checkpoint,
        requestId: record.id,
        owner: record.owner,
      });
      if (checkpoint.bindingSha256 !== expectedBindingSha256) {
        throw new StorageIntegrityError("Agent checkpoint changed after resume validation.");
      }
      record.status = "running";
      record.endedAt = null;
      record.exitCode = null;
      await this.save(record);
      return checkpoint;
    });
  }

  appendInteractiveInputDigest(id: string, digest: string): Promise<void> {
    return this.serialize(async () => {
      if (!/^[a-f0-9]{64}$/.test(digest)) {
        throw new StorageIntegrityError("Execution interactive input digest is invalid.");
      }
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (record.status !== "running" || !record.trust || record.trust.decision !== "approved") {
        throw new StorageIntegrityError("Interactive input requires a running approved execution.");
      }
      const previous = record.trust.interactiveInputDigests ?? [];
      if (previous.length >= 256) throw new StorageIntegrityError("Execution interactive input history is full.");
      record.trust = { ...record.trust, interactiveInputDigests: [...previous, digest] };
      await this.save(record);
    });
  }


  finish(
    id: string,
    status: "completed" | "cancelled" | "failed",
    exitCode: number | null,
    options: { runtimeReceiptId?: string | null } = {},
  ): Promise<void> {
    return this.serialize(async () => {
      if (!["completed", "cancelled", "failed"].includes(status) ||
          (exitCode !== null && !Number.isSafeInteger(exitCode))) {
        throw new StorageIntegrityError("Execution journal final state is invalid.");
      }
      if (options.runtimeReceiptId != null && !UUID.test(options.runtimeReceiptId)) {
        throw new StorageIntegrityError("Execution runtime receipt id must be a lowercase UUID.");
      }
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (record.status !== "running" && record.status !== "waiting_approval") throw new StorageIntegrityError("Execution journal record is already finalized.");
      if (
        record.version === 2
        && record.events
        && foldAgentToolDispatchState(record.events, record.id).some((dispatch) => dispatch.status === "outcome_unknown")
      ) {
        throw new StorageIntegrityError("Outcome-unknown agent dispatch requires reconciliation; it cannot be finalized normally.");
      }
      if (options.runtimeReceiptId != null) {
        if (!record.trust) throw new StorageIntegrityError("Execution runtime receipt link requires GM-11 trust facts.");
        record.trust = { ...record.trust, runtimeReceiptId: options.runtimeReceiptId };
      }
      record.status = status;
      record.exitCode = exitCode;
      record.endedAt = new Date(Math.max(Date.now(), Date.parse(record.startedAt))).toISOString();
      await this.save(record);
    });
  }

  /**
   * L5 fail-closed terminal transition for an ambiguous post-dispatch outcome.
   * It records interruption only; it never retries, reconciles or executes.
   */
  markAgentReconciliationRequired(id: string): Promise<void> {
    return this.serialize(async () => {
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (record.status !== "running") throw new StorageIntegrityError("Only a running agent execution can require reconciliation.");
      if (record.version !== 2 || !record.events) throw new StorageIntegrityError("Execution journal record is not an agent run.");
      const dispatches = foldAgentToolDispatchState(record.events, record.id);
      if (!dispatches.some((dispatch) => dispatch.status === "outcome_unknown")) {
        throw new StorageIntegrityError("Execution has no outcome-unknown tool dispatch to reconcile.");
      }
      record.status = "interrupted";
      record.exitCode = null;
      record.endedAt = new Date(Math.max(Date.now(), Date.parse(record.startedAt))).toISOString();
      await this.save(record);
    });
  }

  /**
   * Checkpoint-aware Stop (SI-02 restart-resume). A running or approval-paused v2 agent run that already holds a valid
   * owner-bound checkpoint and no outcome-unknown dispatch becomes `interrupted` (non-terminal for resume purposes) instead
   * of terminal `cancelled`. It records the end time only: nothing resumes, executes or reconciles here. Any record that
   * does not qualify is refused so the caller can fall back to the ordinary terminal `cancelled` finish.
   */
  interruptCheckpointed(id: string, owner: ExecutionOwner): Promise<void> {
    const requestedOwner = { ...owner };
    return this.serialize(async () => {
      if (!ownerSchema.safeParse(requestedOwner).success) throw new StorageIntegrityError("Execution journal owner is invalid.");
      const record = await this.load(id);
      if (!record) throw new StorageNotFoundError();
      if (
        record.owner.userId !== requestedOwner.userId ||
        record.owner.projectId !== requestedOwner.projectId ||
        record.owner.chatId !== requestedOwner.chatId
      ) {
        throw new StorageNotFoundError();
      }
      if (record.status !== "running" && record.status !== "waiting_approval") {
        throw new StorageIntegrityError("Only a running or approval-paused agent execution can be interrupted at a checkpoint.");
      }
      if (record.version !== 2 || !record.events || !record.checkpoint) {
        throw new StorageIntegrityError("Execution has no durable agent checkpoint to interrupt at.");
      }
      if (foldAgentToolDispatchState(record.events, record.id).some((dispatch) => dispatch.status === "outcome_unknown")) {
        throw new StorageIntegrityError("Outcome-unknown agent dispatch must be reconciled; it cannot be checkpoint-interrupted.");
      }
      const checkpoint = assertAgentCheckpointStoredFor({ snapshot: record.checkpoint, requestId: record.id, owner: record.owner });
      if (checkpoint.toolOutcome === "outcome_unknown") {
        throw new StorageIntegrityError("An outcome-unknown checkpoint cannot be interrupted for resume.");
      }
      record.status = "interrupted";
      record.exitCode = null;
      record.endedAt = new Date(Math.max(Date.now(), Date.parse(record.startedAt))).toISOString();
      await this.save(record);
    });
  }

  /**
   * Record lookup by id for its owning user only. Explicit resume receives nothing but a requestId, so the Project/Chat tuple
   * comes from the record itself and the caller MUST then authorize that chat for this user before acting on it.
   */
  readForUser(id: string, userId: number): Promise<ExecutionJournalRecord | null> {
    return this.serialize(async () => {
      if (!Number.isSafeInteger(userId) || userId < 1) throw new StorageIntegrityError("Execution journal owner is invalid.");
      const record = await this.load(id);
      return record && record.owner.userId === userId ? record : null;
    });
  }

  read(id: string, owner: ExecutionOwner): Promise<ExecutionJournalRecord | null> {
    const requestedOwner = { ...owner };
    return this.serialize(async () => {
      if (!ownerSchema.safeParse(requestedOwner).success) throw new StorageIntegrityError("Execution journal owner is invalid.");
      const record = await this.load(id);
      return record && record.owner.userId === requestedOwner.userId &&
        record.owner.projectId === requestedOwner.projectId && record.owner.chatId === requestedOwner.chatId ? record : null;
    });
  }

  list(owner: ExecutionOwner): Promise<ExecutionJournalRecord[]> {
    const requestedOwner = { ...owner };
    return this.serialize(async () => {
      if (!ownerSchema.safeParse(requestedOwner).success) throw new StorageIntegrityError("Execution journal owner is invalid.");
      return (await this.discover()).filter((record) =>
        record.owner.userId === requestedOwner.userId && record.owner.projectId === requestedOwner.projectId &&
        record.owner.chatId === requestedOwner.chatId).reverse();
    });
  }

  recoverInterrupted(): Promise<void> {
    return this.serialize(async () => {
      // Authenticate and validate every record before converting any running one.
      for (const record of await this.discover()) {
        // Restart ends both a running run and an approval pause: the live lease and in-memory run registry that an
        // approval continuation depends on are gone, so nothing resumes after a restart and nothing executes here.
        if (record.status !== "running" && record.status !== "waiting_approval") continue;
        record.status = "interrupted";
        record.endedAt = new Date(Math.max(Date.now(), Date.parse(record.startedAt))).toISOString();
        record.exitCode = null;
        await this.save(record);
      }
    });
  }
}

export async function createExecutionJournal(options: ExecutionJournalOptions = {}): Promise<ExecutionJournal> {
  const maxTranscriptChars = validLimit(options.maxTranscriptChars ?? DEFAULT_TRANSCRIPT_CHARS, DEFAULT_TRANSCRIPT_CHARS);
  const maxRecords = validLimit(options.maxRecords ?? DEFAULT_MAX_RECORDS, DEFAULT_MAX_RECORDS);
  const directory = await prepareDirectory(path.resolve(options.directory ?? dataPath("execution-journal")));
  const key = await loadOrCreateStorageKey(options.keyDirectory);
  const provider = new EncryptedStorageProvider(new FilesystemStorageProvider(directory), key, { acceptPlaintext: false });
  return new ExecutionJournal(directory, provider, maxTranscriptChars, maxRecords);
}
