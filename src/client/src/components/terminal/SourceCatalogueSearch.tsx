/**
 * Adapted from bidyut10/opensourceui components/inputs/search-input.tsx
 * Upstream: https://github.com/bidyut10/opensourceui
 * Pin: 892f486fdf0d46a44b21ddf3fa32a41a3a71173a (MIT, © 2026 Bidyut Kundu)
 * Adaptations: LIOS dark tokens, Tailwind 3/React 18, no Next.js, no new deps;
 * same labelled searchbox, clear-to-focus and controlled/uncontrolled behavior.
 * Full upstream notice and path-level disposition: docs/technical/LIOS_OPENSOURCEUI_ADOPTION_2026-10-23.md
 */
import * as React from "react";
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type ComponentPropsWithoutRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

type SearchProps = Readonly<{
  label?: string;
  hint?: string;
  error?: boolean;
  errorMessage?: string;
  clearLabel?: string;
  containerClassName?: string;
  onClear?: () => void;
} & Omit<ComponentPropsWithoutRef<"input">, "size" | "type" | "onChange">> & {
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
};

export const SourceCatalogueSearch = forwardRef<HTMLInputElement, SearchProps>(function SourceCatalogueSearch({
  className,
  containerClassName,
  id,
  label = "Search sources",
  hint,
  error = false,
  errorMessage = "Enter a valid search.",
  clearLabel = "Clear source search",
  disabled,
  value,
  defaultValue = "",
  placeholder = "Find a source…",
  onChange,
  onClear,
  ...props
}, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const localRef = useRef<HTMLInputElement | null>(null);
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(String(defaultValue));
  const current = controlled ? String(value) : internal;
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (!controlled) setInternal(event.target.value);
    onChange?.(event.target.value, event);
  }, [controlled, onChange]);
  const handleClear = useCallback(() => {
    if (!controlled) setInternal("");
    onClear?.();
    localRef.current?.focus();
  }, [controlled, onClear]);
  const setRefs = useCallback((node: HTMLInputElement | null) => {
    localRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  useEffect(() => {
    if (controlled) return;
    const form = localRef.current?.form;
    if (!form) return;
    const reset = () => setInternal(String(defaultValue));
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [controlled, defaultValue]);

  return <div data-slot="source-catalogue-search" data-error={error || undefined} className={cn("w-full", containerClassName)}>
    <label htmlFor={inputId} className="sr-only">{label}</label>
    <div className="relative">
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
      <input
        {...props}
        ref={setRefs}
        id={inputId}
        type="search"
        role="searchbox"
        disabled={disabled}
        value={current}
        placeholder={placeholder}
        aria-invalid={error || undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        onChange={handleChange}
        className={cn(
          "h-10 w-full rounded-md border border-border bg-background py-2 pl-9 pr-10 font-ui text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50",
          "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
          className
        )}
      />
      {current && !disabled && <button type="button" aria-label={clearLabel} onClick={handleClear} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><X size={14} aria-hidden="true"/></button>}
    </div>
    {error ? <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">{errorMessage}</p> : hint ? <p id={hintId} className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
  </div>;
});
SourceCatalogueSearch.displayName = "SourceCatalogueSearch";