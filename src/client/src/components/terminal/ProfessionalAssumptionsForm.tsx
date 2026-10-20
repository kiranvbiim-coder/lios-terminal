import * as React from "react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  P5_MANUAL_ASSUMPTIONS_LABEL,
  formatP5GuidedAssumptionsMessage,
  validateP5GuidedValues,
  type P5GuidedInputs,
} from "@shared/p5GuidedInputs";

interface Props {
  guided: P5GuidedInputs;
  /** Sends the confirmed assumptions through the normal chat request path. */
  onSubmit: (message: string) => void;
  onCancel: () => void;
  busy?: boolean;
  initialValues?: Record<string, string>;
  initialStep?: "edit" | "review";
}

function groupFields<T extends { group: string }>(fields: T[]): Array<{ group: string; fields: T[] }> {
  const groups: Array<{ group: string; fields: T[] }> = [];
  for (const field of fields) {
    const existing = groups.find((item) => item.group === field.group);
    if (existing) existing.fields.push(field);
    else groups.push({ group: field.group, fields: [field] });
  }
  return groups;
}

/**
 * The guided form behind the existing "Tell LiOS the assumptions or model inputs you want to use" recovery
 * action. It collects exactly the values the model still needs, shows a confirmation preview of the exact values
 * that will run, and submits the same plain-language request a typed message would. It never fills in a value the
 * user has not stated.
 */
export default function ProfessionalAssumptionsForm({ guided, onSubmit, onCancel, busy = false, initialValues, initialStep = "edit" }: Props) {
  const formId = useId();
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...guided.provided, ...initialValues }));
  const [step, setStep] = useState<"edit" | "review">(initialStep);
  const [attempted, setAttempted] = useState(initialStep === "review");
  const validation = useMemo(() => validateP5GuidedValues(guided, values), [guided, values]);
  const groups = useMemo(() => groupFields(guided.fields), [guided.fields]);
  const issueByKey = useMemo(() => new Map(guided.issues.map((issue) => [issue.key, issue.message])), [guided.issues]);
  const generalIssues = guided.issues.filter((issue) => !guided.fields.some((field) => field.key === issue.key));
  const fieldId = (key: string) => formId + "-" + key.replace(/[^a-zA-Z0-9_-]/g, "_");

  useEffect(() => {
    if (step === "review") reviewHeadingRef.current?.focus();
  }, [step]);

  const review = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (validation.parsed) {
      setStep("review");
      return;
    }
    const firstInvalid = guided.fields.find((field) => validation.errors[field.key]);
    if (firstInvalid) document.getElementById(fieldId(firstInvalid.key))?.focus();
  };

  const confirm = () => {
    if (!validation.parsed || busy) return;
    const message = formatP5GuidedAssumptionsMessage(guided.modelPath, { ...validation.parsed, ...(guided.entity ? { entity: guided.entity } : {}) });
    if (message) onSubmit(message);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    }
  };

  if (step === "review" && validation.parsed) {
    const previewGroups = groupFields(validation.preview);
    return (
      <section className="mt-3 rounded-lg border border-border/60 bg-black/25 p-3" aria-labelledby={formId + "-review"} onKeyDown={onKeyDown} data-testid="guided-assumptions-review">
        <h3 id={formId + "-review"} ref={reviewHeadingRef} tabIndex={-1} className="font-ui text-[14px] font-semibold text-foreground outline-none">
          {P5_MANUAL_ASSUMPTIONS_LABEL}
        </h3>
        <p className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">
          LiOS will run {guided.title.toLowerCase()} with exactly these values. Nothing else is assumed or filled in.
        </p>
        {guided.entity && <p className="mt-1 font-ui text-[13px] text-foreground">Company: {guided.entity}</p>}
        <div className="mt-2 space-y-3">
          {previewGroups.map((group) => (
            <div key={group.group}>
              <h4 className="font-ui text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{group.group}</h4>
              <dl className="mt-1 grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1">
                {group.fields.map((row) => (
                  <div key={row.key} className="contents">
                    <dt className="font-ui text-[13px] text-muted-foreground">{row.label}</dt>
                    <dd className="font-ui text-[13px] tabular-nums text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={confirm} disabled={busy} className="rounded-md border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 font-ui text-[13px] font-medium text-foreground hover:bg-amber-300/20 disabled:opacity-50">
            Run with these values
          </button>
          <button type="button" onClick={() => setStep("edit")} className="rounded-md border border-border/60 px-3 py-1.5 font-ui text-[13px] text-muted-foreground hover:text-foreground">
            Edit values
          </button>
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 font-ui text-[13px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="mt-3 rounded-lg border border-border/60 bg-black/25 p-3" aria-labelledby={formId + "-title"} onSubmit={review} onKeyDown={onKeyDown} noValidate data-testid="guided-assumptions-form">
      <h3 id={formId + "-title"} className="font-ui text-[14px] font-semibold text-foreground">{guided.title}</h3>
      <p className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">
        Enter the values you want to use. Fields marked <span aria-hidden="true">*</span><span className="sr-only">with an asterisk</span> are required. LiOS adds no defaults, and you will see exactly what runs before it does.
      </p>
      {!!generalIssues.length && (
        <ul role="status" className="mt-2 space-y-1 rounded border border-amber-300/25 bg-amber-300/[0.04] px-2.5 py-2">
          {generalIssues.map((issue) => <li key={issue.key + issue.message} className="font-ui text-[13px] leading-5 text-amber-100">{issue.message}</li>)}
        </ul>
      )}
      <div className="mt-3 space-y-4">
        {groups.map((group) => (
          <fieldset key={group.group} className="min-w-0">
            <legend className="font-ui text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{group.group}</legend>
            <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
              {group.fields.map((field) => {
                const id = fieldId(field.key);
                const error = attempted ? validation.errors[field.key] : undefined;
                const serverIssue = issueByKey.get(field.key);
                const describedBy = [field.unitLabel ? id + "-unit" : "", field.help ? id + "-help" : "", serverIssue ? id + "-issue" : "", error ? id + "-error" : ""].filter(Boolean).join(" ");
                return (
                  <div key={field.key} className={field.kind === "number_list" ? "sm:col-span-2" : undefined}>
                    <label htmlFor={id} className="font-ui text-[13px] font-medium text-foreground">
                      {field.label}
                      {field.required && <span aria-hidden="true" className="ml-0.5 text-amber-200">*</span>}
                      {field.required && <span className="sr-only"> (required)</span>}
                    </label>
                    <input
                      id={id}
                      name={field.key}
                      type="text"
                      inputMode={field.kind === "text" ? "text" : "decimal"}
                      autoComplete="off"
                      required={field.required}
                      aria-required={field.required}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={describedBy || undefined}
                      value={values[field.key] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                      className="mt-1 w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-ui text-[13px] text-foreground focus:border-amber-300/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-300/50"
                    />
                    {field.unitLabel && <p id={id + "-unit"} className="mt-0.5 font-ui text-[12px] text-muted-foreground">Unit: {field.unitLabel}</p>}
                    {field.help && <p id={id + "-help"} className="font-ui text-[12px] text-muted-foreground">{field.help}</p>}
                    {serverIssue && <p id={id + "-issue"} className="mt-0.5 font-ui text-[12px] text-amber-200">{serverIssue}</p>}
                    {error && <p id={id + "-error"} role="alert" className="mt-0.5 font-ui text-[12px] text-red-200">{error}</p>}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className="rounded-md border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 font-ui text-[13px] font-medium text-foreground hover:bg-amber-300/20">
          Review values
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 font-ui text-[13px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </form>
  );
}
