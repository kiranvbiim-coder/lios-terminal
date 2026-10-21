import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TerminalExecutionVersion } from "@shared/terminalArtifact";
import { apiRequest } from "./queryClient";
import { useTerminalArtifactContext } from "./terminalArtifactState";

/** Existing advanced HTTP/P11 execution; canonical P4 owns retained results, never this hook. */
export function useTerminalQuantRun() {
  const terminal = useTerminalArtifactContext();
  const context = useRef(terminal); context.current = terminal;
  const editorKey = `native-quant:${useId()}`;
  const inFlight = useRef(0);
  const [running, setRunning] = useState(false);
  const setEditing = terminal?.setEditing;
  useEffect(() => () => { if (inFlight.current === 0) setEditing?.(editorKey, false); }, [setEditing, editorKey]);
  const run = useCallback(async <T extends Record<string, unknown>>(path: string, parameters: Record<string, unknown>, slot: string): Promise<T> => {
    const owner = context.current;
    if (owner?.readOnly) throw new Error("Open the current terminal revision before running an analytic.");
    const submitted = owner?.captureExecution?.(slot);
    inFlight.current++; setRunning(true); owner?.setEditing(editorKey, true);
    try {
      const response = await apiRequest("POST", `/api/quant/advanced/${path}`, submitted ? { ...parameters, terminalArtifact: submitted } : parameters);
      const output = await response.json() as T & { terminalArtifact?: TerminalExecutionVersion };
      if (submitted) {
        if (!output.terminalArtifact) throw new Error("Native result was returned without its canonical terminal revision. No retained result is claimed.");
        await owner?.completeExecution?.(output.terminalArtifact, submitted);
      }
      delete output.terminalArtifact;
      return output;
    } finally {
      inFlight.current--; setRunning(inFlight.current > 0);
      owner?.setEditing(editorKey, inFlight.current > 0);
    }
  }, [editorKey]);
  return { run, running, stored: terminal?.executions, readOnly: terminal?.readOnly ?? false };
}
