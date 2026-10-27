import { z } from "zod";
import { runtimeHealthReportSchema } from "@shared/runtimeContracts";

export const runtimeDoctorSnapshotSchema = z.object({
  contractVersion: z.string().min(1),
  health: z.array(runtimeHealthReportSchema).max(2000),
}).strict();
export type RuntimeDoctorSnapshot = z.infer<typeof runtimeDoctorSnapshotSchema>;

const problemStates = new Set(["degraded", "unavailable", "not_installed", "disabled"]);
export function summarizeRuntimeDoctor(snapshot: RuntimeDoctorSnapshot | null) {
  if (!snapshot) return { status: "unverified" as const, checked: 0, impaired: 0, available: 0, unverified: 0, records: [] as RuntimeDoctorSnapshot["health"] };
  const records = [...snapshot.health].sort((a,b) => a.componentId.localeCompare(b.componentId));
  const impaired = records.filter(item => problemStates.has(item.state)).length;
  const available = records.filter(item => item.state === "available").length;
  const unverified = records.filter(item => item.state === "configurable").length;
  return {
    status: impaired ? "attention" as const : unverified ? "partial" as const : "observed" as const,
    checked: records.length, impaired, available, unverified, records,
  };
}
