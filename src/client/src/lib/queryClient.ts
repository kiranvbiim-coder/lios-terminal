import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { withActiveBrainLinkedContext } from "./brainRunRequest";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const requestData = withActiveBrainLinkedContext(method, url, data);
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: requestData ? { "Content-Type": "application/json" } : {},
    body: requestData ? JSON.stringify(requestData) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      gcTime: 10 * 60 * 1000, // keep unused data in memory for 10 min before GC
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});