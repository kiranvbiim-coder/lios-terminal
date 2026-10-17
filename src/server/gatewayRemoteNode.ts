import { gatewayError } from "@shared/gatewayProtocol";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { REMOTE_DIAGNOSIS_CAPABILITY, REMOTE_FINANCE_CAPABILITY, REMOTE_OPERATION_TIMEOUT_MS, remoteOperationBindingSchema, remoteDiagnosisReportSchema, remoteFinanceReportSchema, remoteNodePlacementSelectionSchema, type RemoteFinanceSource, type RemoteOperationBinding, type RemoteOperationOutcome, type RemoteNodePlacementPolicy, type RemoteNodePlacementSelection, type RemoteNodeHardwareEvidence } from "@shared/remoteNode";
import { GatewayMethodError, type GatewayConnection, type GatewayHub } from "./gatewayHub";
import { requireCurrentGatewayUser } from "./gatewayDeviceContinuity";
import { getConversationExecutionJournal } from "./exec/execution-scope";
import type { ExecutionJournal } from "./exec/execution-journal";

/** Adapted mechanism: OpenClaw c074824a27c96d3983043f9eeb33823cd1772d8c,
 * src/gateway/node-invoke-placement-grant.ts (MIT, OpenClaw Foundation 2026):
 * exact owner/node/generation and current-owner checks. No donor registry,
 * standing approval, shell or subprocess ExecutionBackend is imported. */
const STATE = "node.closed-read-operations.v1";
interface WorkerState { lastPoll: number; financeSources: RemoteFinanceSource[]; diagnostic?: RemoteNodeHardwareEvidence; active?: ActiveOperation }
interface ActiveOperation {
  binding: RemoteOperationBinding;
  placement?: PlacementAdmission;
  requester: GatewayConnection;
  worker: GatewayConnection;
  journal: Promise<ExecutionJournal>;
  admission: Promise<void>;
  dispatched: boolean;
  claimed: boolean;
  timer?: NodeJS.Timeout;
  resolve: (value: RemoteOperationOutcome) => void;
  reject: (error: unknown) => void;
}
type CurrentAuthority = (connection: GatewayConnection) => Promise<unknown>;
type PlacementAdmission = { policy: RemoteNodePlacementPolicy; selection: RemoteNodePlacementSelection };
type NodeAdmission = RemoteNodePlacementSelection["target"] & { requestId: string; placement?: PlacementAdmission };

export function registerRemoteNodeGateway(hub: GatewayHub, options: { journal?: () => Promise<ExecutionJournal>; requireCurrent?: CurrentAuthority } = {}): void {
  const journal = options.journal ?? getConversationExecutionJournal;
  const requireCurrent = options.requireCurrent ?? requireCurrentGatewayUser;
  // Authenticates selection data, not execution permission. Every use still
  // passes current device/account and operation admission in this same module.
  const selectionSealKey = randomBytes(32);
  const live = (connection: GatewayConnection) => hub.isReadyConnection(connection);
  const state = (connection: GatewayConnection) => connection.state.get(STATE) as WorkerState | undefined;
  const deny = (message: string): never => { throw new GatewayMethodError(gatewayError("UNAVAILABLE", message)); };
  const finish = async (active: ActiveOperation, reason: RemoteOperationOutcome["reason"], report: RemoteOperationOutcome["report"] = null): Promise<void> => {
    if (active.claimed) return;
    active.claimed = true;
    clearTimeout(active.timer);
    const outcome: RemoteOperationOutcome = {
      binding: active.binding, status: reason === "reported" ? "completed" : "failed",
      outcome: reason === "reported" ? "remote-reported" : active.dispatched ? "outcome-unknown" : "not-dispatched",
      homeVerified: { authenticatedDeviceId: active.binding.deviceId, connectionGenerationId: active.binding.generationId, capability: active.binding.capability },
      report, reason, independentHardwareVerification: false,
    };
    try {
      await active.admission;
      const store = await active.journal;
      await store.append(active.binding.requestId, "stdout", JSON.stringify(outcome));
      await store.finish(active.binding.requestId, outcome.status, null);
      if (reason === "reported" && active.binding.capability === REMOTE_DIAGNOSIS_CAPABILITY) {
        const diagnostic = remoteDiagnosisReportSchema.parse(report);
        const workerState = state(active.worker);
        if (workerState) workerState.diagnostic = {
          requestId: active.binding.requestId, generationId: active.binding.generationId,
          receivedAt: new Date().toISOString(), observedAt: diagnostic.observedAt,
          freeMemoryBytes: diagnostic.freeMemoryBytes, totalMemoryBytes: diagnostic.totalMemoryBytes,
          reportHash: createHash("sha256").update(JSON.stringify(diagnostic)).digest("hex"), trust: "remote-reported",
        };
      }
      active.resolve(outcome);
    } catch (error) { active.reject(error); throw error; }
    finally { const workerState = state(active.worker); if (workerState?.active === active) workerState.active = undefined; }
  };
  const failClosed = (active: ActiveOperation, reason: RemoteOperationOutcome["reason"]) => {
    void finish(active, reason).catch(() => { /* The awaiting run receives the persistence failure. */ });
  };
  const current = async (connection: GatewayConnection) => {
    if (!live(connection)) deny("The exact Gateway connection is no longer live.");
    await requireCurrent(connection);
    if (!live(connection)) deny("The exact Gateway connection disconnected during admission.");
  };
  hub.onConnectionClosed((connection) => {
    for (const worker of hub.readyConnections()) { const active = state(worker)?.active; if (active?.requester === connection) failClosed(active, "disconnected"); }
    const active = state(connection)?.active;
    if (active) failClosed(active, "disconnected");
    connection.state.delete(STATE);
  });
  const discover = async (connection: GatewayConnection) => {
    await current(connection);
    const workers: GatewayConnection[] = [];
    for (const worker of hub.readyConnections()) {
      if (worker.identity.userId !== connection.identity.userId || !worker.identity.deviceId || !state(worker) || Date.now() - state(worker)!.lastPoll > 2000) continue;
      try { await current(worker); } catch { continue; }
      workers.push(worker);
      if (workers.length === 256) break;
    }
    return workers;
  };
  hub.register("node.diagnosis.list", async (_params, connection) => ({ nodes: (await discover(connection)).map((worker) => ({ deviceId: worker.identity.deviceId!, generationId: worker.connId, capability: REMOTE_DIAGNOSIS_CAPABILITY })) }));
  hub.register("node.finance.list", async (_params, connection) => ({ nodes: (await discover(connection)).flatMap((worker) => state(worker)!.financeSources.map((source) => ({ deviceId: worker.identity.deviceId!, generationId: worker.connId, capability: REMOTE_FINANCE_CAPABILITY, source }))) }));
  const requireHardware = (workerState: WorkerState, generationId: string, policy: RemoteNodePlacementPolicy) => {
    if (!policy.hardware) return null;
    if (policy.hardware.evidence !== "remote-reported") return deny("Independent hardware attestation is unavailable for these node capabilities.");
    const evidence = workerState.diagnostic;
    const now = Date.now();
    if (!evidence || evidence.generationId !== generationId || Date.parse(evidence.receivedAt) > now || now - Date.parse(evidence.receivedAt) > policy.hardware.maxAgeMs || Date.parse(evidence.observedAt) > now || now - Date.parse(evidence.observedAt) > policy.hardware.maxAgeMs || evidence.freeMemoryBytes > evidence.totalMemoryBytes || evidence.freeMemoryBytes < policy.hardware.minimumFreeMemoryBytes) return deny("Fresh same-generation remote-reported memory evidence does not satisfy this policy.");
    return evidence;
  };
  const assertPlacement = (operation: NodeAdmission | RemoteOperationBinding, requester: GatewayConnection, worker: GatewayConnection, workerState: WorkerState, placement?: PlacementAdmission) => {
    if (!placement) return;
    const { signature, ...unsigned } = placement.selection;
    const expected = createHmac("sha256", selectionSealKey).update(JSON.stringify(unsigned)).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return deny("The selected node or policy evidence was altered.");
    const selection = placement.selection;
    if (selection.userId !== requester.identity.userId || selection.requesterGenerationId !== requester.connId || selection.requestId !== operation.requestId || Date.now() >= Date.parse(selection.expiresAt) || selection.policyHash !== createHash("sha256").update(JSON.stringify(placement.policy)).digest("hex") || JSON.stringify(selection.policy) !== JSON.stringify(placement.policy)) return deny("The placement policy, owner, request or selection deadline changed.");
    const target = selection.target;
    if (target.deviceId !== operation.deviceId || target.generationId !== operation.generationId || target.capability !== operation.capability || worker.connId !== target.generationId || worker.identity.deviceId !== target.deviceId || !placement.policy.approvedDeviceIds.includes(target.deviceId) || placement.policy.capability !== target.capability) return deny("The selected exact node generation or capability changed.");
    if (operation.capability === REMOTE_FINANCE_CAPABILITY) {
      if (target.capability !== REMOTE_FINANCE_CAPABILITY || placement.policy.capability !== REMOTE_FINANCE_CAPABILITY || JSON.stringify(target.source) !== JSON.stringify(operation.source) || JSON.stringify(placement.policy.source) !== JSON.stringify(operation.source) || !workerState.financeSources.some((source) => source.sourceId === operation.source.sourceId && source.inputHash === operation.source.inputHash)) return deny("The selected finance source identity or input hash changed.");
    }
    const hardware = requireHardware(workerState, worker.connId, placement.policy);
    if (JSON.stringify(hardware) !== JSON.stringify(selection.hardwareEvidence)) return deny("The selected hardware observation changed; select again explicitly.");
  };
  hub.register("node.operation.select", async (params, connection) => {
    if (params.policy.hardware?.evidence === "independent-attestation") return deny("Independent hardware attestation is unavailable for these node capabilities.");
    const candidates = (await discover(connection)).filter((worker) => params.policy.approvedDeviceIds.includes(worker.identity.deviceId!) && state(worker) && !state(worker)!.active);
    candidates.sort((left, right) => {
      const a = `${left.identity.deviceId}:${left.connId}`;
      const b = `${right.identity.deviceId}:${right.connId}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const worker of candidates) {
      try { await current(worker); } catch { continue; }
      await current(connection);
      const workerState = state(worker);
      if (!workerState || workerState.active || Date.now() - workerState.lastPoll > 2000) continue;
      if (params.policy.capability === REMOTE_FINANCE_CAPABILITY) {
        const expectedSource = params.policy.source;
        if (!workerState.financeSources.some((source) => source.sourceId === expectedSource.sourceId && source.inputHash === expectedSource.inputHash)) continue;
      }
      let hardwareEvidence: RemoteNodeHardwareEvidence | null;
      try { hardwareEvidence = requireHardware(workerState, worker.connId, params.policy); } catch { continue; }
      const target = params.policy.capability === REMOTE_FINANCE_CAPABILITY
        ? { deviceId: worker.identity.deviceId!, generationId: worker.connId, capability: REMOTE_FINANCE_CAPABILITY, source: params.policy.source }
        : { deviceId: worker.identity.deviceId!, generationId: worker.connId, capability: REMOTE_DIAGNOSIS_CAPABILITY };
      const selectedAt = Date.now();
      const selection = remoteNodePlacementSelectionSchema.parse({
        requestId: params.requestId, userId: connection.identity.userId, requesterGenerationId: connection.connId,
        policy: params.policy, policyHash: createHash("sha256").update(JSON.stringify(params.policy)).digest("hex"),
        target, selectedAt: new Date(selectedAt).toISOString(), expiresAt: new Date(selectedAt + REMOTE_OPERATION_TIMEOUT_MS).toISOString(),
        hardwareEvidence, signature: "0".repeat(64),
      });
      const { signature: _signature, ...unsigned } = selection;
      selection.signature = createHmac("sha256", selectionSealKey).update(JSON.stringify(unsigned)).digest("hex");
      return selection;
    }
    return deny("No current owner-approved node satisfies this exact capability, source and hardware policy; no fallback is permitted.");
  });

  const admit = async (params: NodeAdmission, connection: GatewayConnection) => {
    await current(connection);
    const worker = hub.readyConnections().find((candidate) => candidate.connId === params.generationId && candidate.identity.deviceId === params.deviceId && candidate.identity.userId === connection.identity.userId);
    if (!worker) return deny("The exact paired node generation is unavailable; no fallback is permitted.");
    await current(worker);
    const workerState = state(worker);
    if (!workerState || Date.now() - workerState.lastPoll > 2000 || workerState.active) return deny("The node is not ready or already has an operation in flight.");
    if (params.capability === REMOTE_FINANCE_CAPABILITY && !workerState.financeSources.some((source) => source.sourceId === params.source.sourceId && source.inputHash === params.source.inputHash)) return deny("The exact node-local finance source is unavailable or changed.");
    assertPlacement(params, connection, worker, workerState, params.placement);
    const { placement, ...operation } = params;
    const placementDigest = placement ? createHash("sha256").update(JSON.stringify(placement.selection)).digest("hex") : undefined;
    const binding = remoteOperationBindingSchema.parse({ ...operation, userId: connection.identity.userId, expiresAt: new Date(Date.now() + REMOTE_OPERATION_TIMEOUT_MS).toISOString(), ...(placementDigest ? { placementDigest } : {}) });
    let resolve!: ActiveOperation["resolve"];
    let reject!: ActiveOperation["reject"];
    const result = new Promise<RemoteOperationOutcome>((accept, refuse) => { resolve = accept; reject = refuse; });
    const store = journal();
    const active: ActiveOperation = { binding, placement, requester: connection, worker, journal: store, admission: Promise.resolve(), dispatched: false, claimed: false, resolve, reject };
    workerState.active = active;
    active.admission = store.then(async (value) => {
      await value.begin({ id: binding.requestId, owner: { userId: binding.userId, projectId: null, chatId: null }, label: binding.capability === REMOTE_FINANCE_CAPABILITY ? "Paired node P6 finance snapshot (read-only)" : "Paired node runtime diagnosis (read-only)" });
      await value.append(binding.requestId, "stdout", JSON.stringify({ operation: binding, placement: placement?.selection ?? "paired-node-closed-read-only", authority: "current-owner-read", subprocess: false }) + "\n");
    });
    active.timer = setTimeout(() => failClosed(active, "timeout"), REMOTE_OPERATION_TIMEOUT_MS);
    void active.admission.catch((error) => { if (!active.claimed) { active.claimed = true; clearTimeout(active.timer); workerState.active = undefined; reject(error); } });
    return result;
  };
  hub.register("node.diagnosis.run", admit);
  hub.register("node.finance.run", admit);

  hub.register("node.operation.poll", async (params, connection) => {
    if (!connection.identity.deviceId) return deny("Only a signed paired device can offer these closed capabilities.");
    try { await current(connection); }
    catch (error) { const active = state(connection)?.active; if (active) failClosed(active, "authority-changed"); throw error; }
    let workerState = state(connection);
    if (!workerState) { workerState = { lastPoll: Date.now(), financeSources: [] }; connection.state.set(STATE, workerState); }
    workerState.lastPoll = Date.now();
    workerState.financeSources = params.financeSources;
    const active = workerState.active;
    if (!active || active.claimed || active.dispatched) return { generationId: connection.connId, operation: null };
    await active.admission;
    try { await current(active.requester); await current(connection); }
    catch (error) { failClosed(active, "authority-changed"); throw error; }
    if (active.claimed || active.dispatched) return { generationId: connection.connId, operation: null };
    if (Date.now() >= Date.parse(active.binding.expiresAt)) { failClosed(active, "timeout"); return { generationId: connection.connId, operation: null }; }
    try { assertPlacement(active.binding, active.requester, connection, workerState, active.placement); }
    catch (error) { failClosed(active, "placement-changed"); throw error; }
    if (active.binding.capability === REMOTE_FINANCE_CAPABILITY) {
      const expected = active.binding.source;
      if (!params.financeSources.some((source) => source.sourceId === expected.sourceId && source.inputHash === expected.inputHash)) { failClosed(active, "source-unavailable"); return { generationId: connection.connId, operation: null }; }
    }
    active.dispatched = true;
    return { generationId: connection.connId, operation: active.binding };
  });
  hub.register("node.operation.result", async (params, connection) => {
    const active = state(connection)?.active;
    if (!active || active.claimed || !active.dispatched || JSON.stringify(active.binding) !== JSON.stringify(remoteOperationBindingSchema.parse(params.binding))) return deny("No exact, live, dispatched operation matches this result.");
    try { await current(connection); await current(active.requester); }
    catch (error) { failClosed(active, "authority-changed"); throw error; }
    if (active.claimed || Date.now() >= Date.parse(active.binding.expiresAt)) { failClosed(active, "timeout"); return deny("The operation deadline has expired; late results are refused."); }
    try { assertPlacement(active.binding, active.requester, connection, state(connection)!, active.placement); }
    catch (error) { failClosed(active, "placement-changed"); throw error; }
    if (params.failure) {
      if (active.binding.capability !== REMOTE_FINANCE_CAPABILITY || params.report !== null) return deny("Only a failed finance source read can report source-unavailable without output.");
      await finish(active, "source-unavailable");
    } else if (active.binding.capability === REMOTE_FINANCE_CAPABILITY) {
      const report = remoteFinanceReportSchema.parse(params.report);
      if (report.source.sourceId !== active.binding.source.sourceId || report.source.inputHash !== active.binding.source.inputHash) return deny("The reported finance input does not match the exact admitted source.");
      await finish(active, "reported", report);
    } else {
      const report = remoteDiagnosisReportSchema.parse(params.report);
      if (report.freeMemoryBytes > report.totalMemoryBytes) return deny("Reported free memory cannot exceed reported total memory.");
      await finish(active, "reported", report);
    }
    return { accepted: true as const };
  });
}
