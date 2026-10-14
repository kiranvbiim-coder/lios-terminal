import type { AnalyticalModelRun } from "./analyticalCore";
import { AnalyticalModelRegistry, type AnalyticalRunOptions } from "./analyticalRegistry";
import type { AnalyticalScenario } from "./analyticalScenario";

export interface OneWaySensitivitySpec {
  path: string;
  label: string;
  values: number[];
  outputId?: string;
  inputUnit?: "raw" | "percentage-points" | "basis-points";
}

export interface SensitivityPoint {
  inputValue: number;
  outputValue: number | null;
  run: AnalyticalModelRun;
}

export interface OneWaySensitivityResult {
  modelId: string;
  objectId?: string;
  inputPath: string;
  inputLabel: string;
  outputId?: string;
  points: SensitivityPoint[];
  monotonic: "increasing" | "decreasing" | "mixed" | "flat";
}

export interface TwoWaySensitivitySpec {
  x: OneWaySensitivitySpec;
  y: OneWaySensitivitySpec;
  outputId?: string;
}

export interface TwoWaySensitivityCell {
  x: number;
  y: number;
  outputValue: number | null;
  run: AnalyticalModelRun;
}

export interface TwoWaySensitivityResult {
  modelId: string;
  objectId?: string;
  xPath: string;
  yPath: string;
  cells: TwoWaySensitivityCell[];
}

function numericOutput(run: AnalyticalModelRun, outputId?: string): number | null {
  const output = outputId
    ? run.outputs.find((candidate) => candidate.id === outputId)
    : run.outputs.find((candidate) => candidate.role === "primary" && typeof candidate.value === "number");
  return typeof output?.value === "number" && Number.isFinite(output.value) ? output.value : null;
}

function sensitivityScenario(path: string, label: string, value: number, unit: OneWaySensitivitySpec["inputUnit"]): AnalyticalScenario {
  return {
    id: `sensitivity:${path}:${value}`,
    label: `${label} = ${value}`,
    tags: ["sensitivity"],
    shocks: [{
      id: `replace:${path}`,
      label,
      path,
      operation: "replace",
      value,
      unit: unit ?? "raw",
    }],
  };
}

function monotonicity(points: readonly SensitivityPoint[]): OneWaySensitivityResult["monotonic"] {
  const values = points.map((point) => point.outputValue).filter((value): value is number => value !== null);
  if (values.length < 2) return "flat";
  let up = false;
  let down = false;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1]) up = true;
    if (values[index] < values[index - 1]) down = true;
  }
  if (up && down) return "mixed";
  if (up) return "increasing";
  if (down) return "decreasing";
  return "flat";
}

export function runOneWaySensitivity<TPayload>(
  registry: AnalyticalModelRegistry,
  modelId: string,
  payload: TPayload,
  spec: OneWaySensitivitySpec,
  options: Omit<AnalyticalRunOptions, "scenario"> = {},
): OneWaySensitivityResult {
  const points = spec.values.map((value): SensitivityPoint => {
    const scenario = sensitivityScenario(spec.path, spec.label, value, spec.inputUnit);
    const { run } = registry.run(modelId, payload, { ...options, scenario });
    return { inputValue: value, outputValue: numericOutput(run, spec.outputId), run };
  });
  return {
    modelId,
    objectId: options.objectId,
    inputPath: spec.path,
    inputLabel: spec.label,
    outputId: spec.outputId,
    points,
    monotonic: monotonicity(points),
  };
}

export function runTwoWaySensitivity<TPayload>(
  registry: AnalyticalModelRegistry,
  modelId: string,
  payload: TPayload,
  spec: TwoWaySensitivitySpec,
  options: Omit<AnalyticalRunOptions, "scenario"> = {},
): TwoWaySensitivityResult {
  const outputId = spec.outputId ?? spec.x.outputId ?? spec.y.outputId;
  const cells: TwoWaySensitivityCell[] = [];
  for (const x of spec.x.values) {
    for (const y of spec.y.values) {
      const scenario: AnalyticalScenario = {
        id: `sensitivity:${spec.x.path}:${x}:${spec.y.path}:${y}`,
        label: `${spec.x.label} ${x} / ${spec.y.label} ${y}`,
        tags: ["sensitivity", "two-way"],
        shocks: [
          sensitivityScenario(spec.x.path, spec.x.label, x, spec.x.inputUnit).shocks[0],
          sensitivityScenario(spec.y.path, spec.y.label, y, spec.y.inputUnit).shocks[0],
        ],
      };
      const { run } = registry.run(modelId, payload, { ...options, scenario });
      cells.push({ x, y, outputValue: numericOutput(run, outputId), run });
    }
  }
  return {
    modelId,
    objectId: options.objectId,
    xPath: spec.x.path,
    yPath: spec.y.path,
    cells,
  };
}

export function findSensitivityBreakEven(
  points: readonly SensitivityPoint[],
  targetOutput: number,
): number | null {
  const ordered = [...points]
    .filter((point): point is SensitivityPoint & { outputValue: number } => point.outputValue !== null)
    .sort((a, b) => a.inputValue - b.inputValue);
  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1];
    const right = ordered[index];
    const leftGap = left.outputValue - targetOutput;
    const rightGap = right.outputValue - targetOutput;
    if (leftGap === 0) return left.inputValue;
    if (rightGap === 0) return right.inputValue;
    if (leftGap * rightGap < 0 && right.outputValue !== left.outputValue) {
      const alpha = (targetOutput - left.outputValue) / (right.outputValue - left.outputValue);
      return left.inputValue + alpha * (right.inputValue - left.inputValue);
    }
  }
  return null;
}
