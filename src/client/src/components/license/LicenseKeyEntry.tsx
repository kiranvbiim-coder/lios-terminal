import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { serverErrorText } from "@/lib/apiErrorText";
import { LICENSE_ACCESS_KEY, LICENSE_STATUS_QUERY_KEY, licenseEntryProblem } from "@/lib/licenseAccess";

/**
 * Paste-a-key box: the pasted text goes to the same import route as a license file. Whitespace and line breaks
 * from copying are fine; the server says exactly why a key is refused.
 */
export default function LicenseKeyEntry({ onActivated, submitLabel = "Activate license key" }: { onActivated?: () => void; submitLabel?: string }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const activate = useMutation({
    mutationFn: async (license: string) => (await apiRequest("POST", "/api/license/import", { license })).json(),
    onSuccess: async (saved) => {
      setProblem(null);
      setText("");
      queryClient.setQueryData(LICENSE_STATUS_QUERY_KEY, saved);
      await queryClient.invalidateQueries({ queryKey: LICENSE_ACCESS_KEY });
      onActivated?.();
    },
    onError: (error) => setProblem(serverErrorText(error)),
  });

  const submit = () => {
    const localProblem = licenseEntryProblem(text);
    setProblem(localProblem);
    if (!localProblem) activate.mutate(text);
  };

  return (
    <form
      className="space-y-2"
      data-testid="license-key-entry"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
    >
      <label htmlFor={fieldId} className="block font-terminal text-[9px] uppercase tracking-wider text-muted-foreground">License key</label>
      <textarea
        id={fieldId}
        value={text}
        rows={4}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder="LIOS1-…"
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        onChange={(event) => { setText(event.target.value); if (problem) setProblem(null); }}
        className="w-full resize-y border border-border bg-black/40 px-2 py-1.5 font-mono text-[10px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      />
      {problem && <p id={errorId} role="alert" className="font-terminal text-[9px] text-rose-300">{problem}</p>}
      <button
        type="submit"
        disabled={activate.isPending}
        className="border border-[hsl(38,95%,50%)]/60 px-3 py-1.5 font-terminal text-[9px] uppercase tracking-wider text-foreground hover:bg-[hsl(38,95%,50%)]/10 disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {activate.isPending ? "Checking key…" : submitLabel}
      </button>
    </form>
  );
}
