import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { GATEWAY_PATH, type GATEWAY_EVENTS, type GatewayEventName } from "@shared/gatewayProtocol";
import { GatewayClient, type GatewayReadyInfo, type GatewayState } from "./gatewayClient";
import { invalidateAllTopics, invalidateTopics } from "./dataInvalidation";

const GatewayContext = createContext<GatewayClient | null>(null);

function createBrowserGatewayClient(): GatewayClient {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new GatewayClient({
    url: `${scheme}//${window.location.host}${GATEWAY_PATH}`,
    clientInfo: { id: "lios-web", version: "1.0.0", platform: navigator.platform || "web", mode: "ui" },
  });
}

/** Holds one shared GatewayClient per tab; connected while `enabled` (signed in), stopped otherwise and on unmount. */
export function GatewayProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [client] = useState(createBrowserGatewayClient);
  const queryClient = useQueryClient();
  // The Home announces what changed; the UI refetches those queries instead of polling, and once after each reconnect.
  useEffect(() => {
    const stopEvents = client.onEvent("data.invalidate", (payload) => invalidateTopics(queryClient, payload.topics));
    const stopReady = client.onReady(() => invalidateAllTopics(queryClient));
    return () => {
      stopEvents();
      stopReady();
    };
  }, [client, queryClient]);
  useEffect(() => {
    if (!enabled) return;
    client.start();
    return () => client.stop();
  }, [client, enabled]);
  return <GatewayContext.Provider value={client}>{children}</GatewayContext.Provider>;
}

/** The shared client, or null outside a GatewayProvider (callers treat the Gateway as an enhancement). */
export function useGateway(): GatewayClient | null {
  return useContext(GatewayContext);
}

export function useGatewayState(): GatewayState {
  const client = useGateway();
  return useSyncExternalStore(
    (notify) => (client ? client.onState(notify) : () => {}),
    () => client?.state ?? "idle",
  );
}

export function useGatewayEvent<E extends GatewayEventName>(
  event: E,
  handler: (payload: z.output<(typeof GATEWAY_EVENTS)[E]>) => void,
): void {
  const client = useGateway();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => client?.onEvent(event, (payload) => handlerRef.current(payload)), [client, event]);
}

/** Runs `handler` after every (re)connect, for views that keep their own state and must resync. */
export function useGatewayReady(handler: (info: GatewayReadyInfo) => void): void {
  const client = useGateway();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => client?.onReady((info) => handlerRef.current(info)), [client]);
}
