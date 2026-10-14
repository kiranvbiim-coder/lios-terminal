import type { ExecutionBackend } from "../exec/backends/types";
import { assertBrowserRuntimeIsolationBackend } from "../exec/browser-isolation";
import { resolveWindowRef, verifyGeneration, verifyFrame, type CuaFrameState, type CuaScreenSize } from "./frame";

export class ComputerRuntimeUnavailableError extends Error {
  readonly code = "computer_runtime_unavailable";
  constructor(readonly reason: "isolated-backend-unavailable" | "native-transport-unavailable") {
    super(`Computer execution is unavailable (${reason}); no host/native fallback is permitted.`);
    this.name = "ComputerRuntimeUnavailableError";
  }
}

/** Native GUI has no qualified LiOS transport yet. A backend claim alone is not a driver. */
export function assertComputerExecutionAvailable(backend?: ExecutionBackend): never {
  try {
    assertBrowserRuntimeIsolationBackend(backend);
  } catch {
    throw new ComputerRuntimeUnavailableError("isolated-backend-unavailable");
  }
  throw new ComputerRuntimeUnavailableError("native-transport-unavailable");
}

/** Explicit scope facts, resolved by the session owner, never inferred from observation risk. */
export function assertComputerCaptureScope(input: {
  scope: "window" | "desktop";
  authorizedScope: "window" | "desktop";
  windowRef: string;
  authorizedWindowRef: string;
  generation: string;
  state: CuaFrameState;
  frame?: { id: string; geometry: CuaScreenSize; referenceWidth: number };
}): void {
  verifyGeneration(input.state, input.generation);
  if (input.scope === "desktop" && input.authorizedScope !== "desktop") {
    throw new Error("COMPUTER_CAPTURE_SCOPE_DENIED: desktop capture requires an explicit desktop grant");
  }
  if (input.windowRef !== input.authorizedWindowRef) {
    throw new Error("COMPUTER_CAPTURE_SCOPE_DENIED: target window is outside the declared grant");
  }
  resolveWindowRef(input.state, input.windowRef);
  if (input.frame) {
    verifyFrame(input.state, input.frame.id, input.frame.geometry, input.frame.referenceWidth);
  }
}
