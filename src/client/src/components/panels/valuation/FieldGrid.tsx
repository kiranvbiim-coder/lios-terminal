import { EditableValue } from "@/components/panels/EditableValue";
import type { Overridable } from "@/lib/useOverridable";

// Renders a list of raw dollar-figure inputs (stored in the overridable hook
// in real units, shown/typed in millions for convenience) as click-to-edit
// EditableValue fields -- the same building block used across Ratios, DDM,
// Beneish and Ohlson so each tab isn't reinventing the money-field wiring.
export function MoneyFieldGrid<K extends string>({ ov, values, fields, curr, decimals = 1 }: {
  ov: Overridable<K>; values: Record<K, number>; fields: Array<{ key: K; label: string }>;
  curr: string; decimals?: number;
}) {
  return (
    <>
      {fields.map(f => (
        <EditableValue
          key={f.key} variant="field" label={f.label} decimals={decimals} suffix="M" prefix={curr}
          value={values[f.key] / 1e6}
          isOverridden={ov.isOverridden(f.key)}
          onReset={() => ov.resetOverride(f.key)}
          onChange={v => ov.setOverride(f.key, v * 1e6)}
        />
      ))}
    </>
  );
}

// Unitless ratio inputs (margins, turnover, etc.) -- no /1e6 scaling.
export function RatioFieldGrid<K extends string>({ ov, values, fields, decimals = 4, suffix = "" }: {
  ov: Overridable<K>; values: Record<K, number>; fields: Array<{ key: K; label: string }>;
  decimals?: number; suffix?: string;
}) {
  return (
    <>
      {fields.map(f => (
        <EditableValue
          key={f.key} variant="field" label={f.label} decimals={decimals} suffix={suffix}
          value={values[f.key]}
          isOverridden={ov.isOverridden(f.key)}
          onReset={() => ov.resetOverride(f.key)}
          onChange={v => ov.setOverride(f.key, v)}
        />
      ))}
    </>
  );
}
