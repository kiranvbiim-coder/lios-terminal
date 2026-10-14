import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import type {
  LedgerIntegrityReport,
  ProjectPortabilityManifestV1,
  ReproducibilityReceipt,
  SessionChangeExplanation,
} from "@shared/ledgerContracts";

export interface ProjectLedgerEvent {
  id: string;
  streamId: string;
  sequence: number;
  projectId: number | null;
  chatId: number | null;
  sessionId: string | null;
  eventType: string;
  actorType: string;
  requestId: string | null;
  receiptId: string | null;
  correlationId: string | null;
  causationId: string | null;
  payload: Record<string, unknown>;
  lineage: Record<string, unknown>;
  reversible: boolean;
  previousHash: string | null;
  eventHash: string;
  createdAt: string;
}

export function useProjectLedger(projectId: number | null, limit = 100) {
  return useQuery<ProjectLedgerEvent[]>({
    queryKey: ["/api/projects", projectId, "ledger", limit],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/ledger?limit=${limit}`);
      if (!response.ok) throw new Error("Failed to load Project Ledger.");
      return response.json();
    },
    enabled: Boolean(projectId),
    staleTime: 5_000,
  });
}

export async function fetchShowWork(receiptId: string): Promise<{
  eventId: string;
  eventHash: string;
  receipt: ReproducibilityReceipt;
}> {
  const response = await fetch(`/api/ledger/receipts/${encodeURIComponent(receiptId)}/show-work`);
  if (!response.ok) throw new Error("Failed to load Show Work receipt.");
  return response.json();
}

export async function verifyProjectLedger(projectId: number): Promise<LedgerIntegrityReport> {
  const streamId = encodeURIComponent(`project:${projectId}`);
  const response = await fetch(`/api/ledger/streams/${streamId}/verify`);
  if (!response.ok) throw new Error("Failed to verify Project Ledger.");
  return response.json();
}

export async function undoProjectLedgerEvent(eventId: string): Promise<ProjectLedgerEvent> {
  return (await apiRequest("POST", `/api/ledger/events/${encodeURIComponent(eventId)}/undo`, {})).json();
}

export async function fetchProjectPortabilityManifest(projectId: number): Promise<ProjectPortabilityManifestV1> {
  const response = await fetch(`/api/projects/${projectId}/portability-manifest`);
  if (!response.ok) throw new Error("Failed to generate Project portability manifest.");
  return response.json();
}

export async function explainProjectSessionChange(leftId: string, rightId: string): Promise<SessionChangeExplanation> {
  const response = await fetch(
    `/api/project-sessions/${encodeURIComponent(leftId)}/explain-change/${encodeURIComponent(rightId)}`,
  );
  if (!response.ok) throw new Error("Failed to explain Session changes.");
  return response.json();
}
