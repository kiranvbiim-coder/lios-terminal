import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface PublishedComponent {
  id: string;
  name: string;
  description: string;
  category: string;
  cells: Record<string, string>;
  publishedByUserId: number;
  publishedAt: string;
}

/** Firm-wide shared component library -- see server/uideEngine/componentLibraryStore.ts for the design note on why this is scoped to the whole firm, not per-workspace. */
export function useComponentLibrary() {
  return useQuery<PublishedComponent[]>({
    queryKey: ["/api/component-library"],
    queryFn: async () => {
      const res = await fetch("/api/component-library");
      if (!res.ok) throw new Error("Failed to fetch the component library");
      return res.json();
    },
  });
}

export async function publishComponent(fields: { name: string; description: string; category: string; cells: Record<string, string> }): Promise<PublishedComponent> {
  const res = await fetch("/api/component-library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to publish component");
  return res.json();
}

export async function deleteComponent(id: string): Promise<void> {
  const res = await fetch(`/api/component-library/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to delete component");
}

export function useInvalidateComponentLibrary() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/component-library"] });
  }, [queryClient]);
}
