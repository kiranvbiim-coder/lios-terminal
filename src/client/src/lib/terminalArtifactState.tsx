import { createContext, useContext, useEffect, useRef, useState, useMemo, useCallback, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { decodeTerminalPanelValue, encodeTerminalPanelValue, type TerminalScreenState } from "@shared/terminalArtifact";
import type { ChatTerminalContext, ChatTerminalControls } from "./chatTerminalContext";
import type { WorkspaceAudience } from "./featureRegistry";

export interface TerminalArtifactTarget {
  artifactId: string; version: number; contentHash: string;
  projectId: number | null; owningChatId: number | null;
}
interface PanelContext {
  symbol: string | null;
  setSymbol: (symbol: string) => void;
  sourceScope: TerminalScreenState["sourceScope"];
  readOnly: boolean;
  state: Record<string, unknown>;
  initialize: (key: string, value: unknown) => void;
  update: (key: string, change: (previous: unknown) => unknown) => void;
  setEditing: (key: string, editing: boolean) => void;
  onAsk?: (id: string, title: string, stagedPrompt?: string) => void;
  target?: TerminalArtifactTarget;
}
const PanelStateContext = createContext<PanelContext | null>(null);
export const TerminalArtifactStateProvider = PanelStateContext.Provider;
export function useTerminalArtifactSymbol(initial: string): [string, Dispatch<SetStateAction<string>>] {
  const context = useTerminalArtifactContext();
  const [local, setLocal] = useState(initial);
  const value = context ? context.symbol ?? "" : local;
  return [value, change => {
    if (!context) { setLocal(change); return; }
    if (!context.readOnly) context.setSymbol(typeof change === "function" ? change(value) : change);
  }];
}
export function useTerminalArtifactContext() { return useContext(PanelStateContext); }

/** Existing panel controls write the current P4 screen's authored state, never a shadow store. */
export function useTerminalArtifactState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const context = useTerminalArtifactContext();
  const [fallback, setFallback] = useState(initial);
  const initialValue = useRef({ key, value: fallback });
  if (initialValue.current.key !== key) initialValue.current = { key, value: typeof initial === "function" ? (initial as () => T)() : initial };
  const contextRef = useRef(context);
  contextRef.current = context;
  useEffect(() => {
    if (context && !context.readOnly) context.initialize(key, encodeTerminalPanelValue(initialValue.current.value));
  }, [key, context?.initialize, context?.readOnly]);
  const stored = context?.state[key];
  const present = context !== null && Object.hasOwn(context.state, key);
  const missing = context ? initialValue.current.value : fallback;
  const value = useMemo(() => present ? decodeTerminalPanelValue(stored) as T : missing, [present, stored, missing]);
  const setter: Dispatch<SetStateAction<T>> = useCallback(change => {
    const owner = contextRef.current;
    if (!owner) { setFallback(change); return; }
    if (owner.readOnly) return;
    owner.update(key, previous => {
      const current = previous === undefined ? initialValue.current.value : decodeTerminalPanelValue(previous) as T;
      return encodeTerminalPanelValue(typeof change === "function" ? (change as (value: T) => T)(current) : change);
    });
  }, [key]);
  return [value, setter];
}

type TerminalRenderer = (context: ChatTerminalContext, controls: ChatTerminalControls) => ReactNode;
const TerminalRendererContext = createContext<{ render: TerminalRenderer; audience: WorkspaceAudience } | null>(null);
/** Dependency injection of Terminal's existing renderer and audience; no second registry. */
export const TerminalArtifactRendererProvider = TerminalRendererContext.Provider;
export function useTerminalArtifactRenderer() { return useContext(TerminalRendererContext)?.render ?? null; }
export function useTerminalArtifactAudience() { return useContext(TerminalRendererContext)?.audience ?? "trial"; }
