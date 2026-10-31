import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  description?: string;
  initialValue: string;
  confirmLabel?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  /** Return a message to block confirmation and show it beside the field. */
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * In-app replacement for window.prompt (unimplemented in Electron renderers):
 * labelled input, Enter confirms, Escape/close cancels, focus returns to the opener.
 */
export function PromptDialog({
  open, title, label, description, initialValue, confirmLabel = "Apply", inputMode, validate, onConfirm, onCancel, onCloseAutoFocus,
}: PromptDialogProps) {
  const [value, setValue] = React.useState(initialValue);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();
  const errorId = `${inputId}-error`;

  React.useEffect(() => {
    if (open) { setValue(initialValue); setError(null); }
  }, [open, initialValue]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const message = validate?.(value) ?? null;
    if (message) { setError(message); return; }
    onConfirm(value);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : "sr-only"}>{description ?? label}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>{label}</Label>
            <Input
              id={inputId}
              value={value}
              inputMode={inputMode}
              autoComplete="off"
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => { setValue(event.target.value); setError(null); }}
              onFocus={(event) => event.currentTarget.select()}
            />
            {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
