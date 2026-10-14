import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface ModelVersion {
  id: string;
  modelId: string;
  cells: Record<string, string>;
  names: Record<string, string>;
  formats: Record<string, string>;
  savedAt: string;
  savedByUserId: number;
}

/** Time Machine -- automatic version history recorded on every model save. See server/uideEngine/modelVersionStore.ts. */
export function useModelVersions(modelId: string | null) {
  return useQuery<ModelVersion[]>({
    queryKey: ["/api/models", modelId, "versions"],
    queryFn: async () => {
      const res = await fetch(`/api/models/${modelId}/versions`);
      if (!res.ok) throw new Error("Failed to fetch model versions");
      return res.json();
    },
    enabled: !!modelId,
  });
}

export async function restoreModelVersion(modelId: string, versionId: string): Promise<{ cells: Record<string, string>; names: Record<string, string>; formats: Record<string, string> }> {
  const res = await fetch(`/api/models/${modelId}/versions/${versionId}/restore`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to restore version");
  return res.json();
}

export function useInvalidateModelVersions() {
  const queryClient = useQueryClient();
  return useCallback((modelId: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/models", modelId, "versions"] });
  }, [queryClient]);
}
