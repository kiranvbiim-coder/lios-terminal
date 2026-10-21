import { useCallback } from "react";
import { useTerminalArtifactState } from "./terminalArtifactState";

// Shared state management for "live data, but every field is yours to
// override" worksheets (the DCF worksheet / WACC builder pattern). Tracks
// only the fields the user has actually touched, keyed by name -- anything
// not in the override map still reads straight from live data, so a panel
// stays correct as new live data arrives for fields the user never touched.
//
// Usage:
//   const ov = useOverridable<"revenue" | "netIncome">();
//   const revenue = ov.getValue("revenue", liveRevenue);
//   <EditableValue value={revenue} isOverridden={ov.isOverridden("revenue")}
//     onChange={(v) => ov.setOverride("revenue", v)} onReset={() => ov.resetOverride("revenue")} />
export function useOverridable<K extends string>(artifactKey = "worksheet.overrides") {
  const [overrides, setOverrides] = useTerminalArtifactState<Partial<Record<K, number>>>(artifactKey, {});

  const getValue = useCallback(
    (key: K, liveValue: number): number => overrides[key] ?? liveValue,
    [overrides],
  );

  const isOverridden = useCallback((key: K): boolean => key in overrides, [overrides]);

  const setOverride = useCallback((key: K, value: number) => {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetOverride = useCallback((key: K) => {
    setOverrides((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const resetAll = useCallback(() => setOverrides({}), []);

  return {
    getValue,
    isOverridden,
    setOverride,
    resetOverride,
    resetAll,
    hasAnyOverride: Object.keys(overrides).length > 0,
    overrideCount: Object.keys(overrides).length,
  };
}

export type Overridable<K extends string> = ReturnType<typeof useOverridable<K>>;
