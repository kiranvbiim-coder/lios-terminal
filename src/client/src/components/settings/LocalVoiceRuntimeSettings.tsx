import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Mic, XCircle } from "lucide-react";
import { getDesktopWorkspaceBridge, type VoiceRuntimeFileKind } from "@/lib/desktopWorkspace";
import { apiRequest } from "@/lib/queryClient";

interface VoiceRuntimeSetup {
  transcriptionProviderReady: boolean;
  recordingReady: boolean;
  whisperExecutable: { available: boolean; name: string | null };
  model: { available: boolean; name: string | null };
  ffmpeg: { available: boolean; name: string | null };
  transcriptionProviders: string[];
  speechProviders: string[];
}

const RUNTIME_FILES: Array<{
  kind: VoiceRuntimeFileKind;
  label: string;
  statusKey: "whisperExecutable" | "model" | "ffmpeg";
}> = [
  { kind: "whisperExecutable", label: "whisper.cpp executable", statusKey: "whisperExecutable" },
  { kind: "model", label: "Whisper model", statusKey: "model" },
  { kind: "ffmpeg", label: "ffmpeg converter", statusKey: "ffmpeg" },
];

export default function LocalVoiceRuntimeSettings() {
  const queryClient = useQueryClient();
  const desktopBridge = useMemo(() => getDesktopWorkspaceBridge(), []);
  const [configuring, setConfiguring] = useState<VoiceRuntimeFileKind | null>(null);
  // Native file dialogs are side effects: block repeated clicks synchronously.
  const configurationInFlight = useRef<VoiceRuntimeFileKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const setupQuery = useQuery<VoiceRuntimeSetup>({
    queryKey: ["/api/voice/setup"],
    queryFn: async () => (await apiRequest("GET", "/api/voice/setup")).json(),
    staleTime: 10_000,
  });

  async function configureRuntimeFile(kind: VoiceRuntimeFileKind): Promise<void> {
    if (configurationInFlight.current) return;
    if (!desktopBridge?.configureVoiceRuntimeFile) {
      setError("Native file selection is available in the installed LiOS desktop app. Development/server environments can use the documented LIOS_WHISPER_CPP_BIN, LIOS_WHISPER_MODEL and LIOS_FFMPEG_BIN settings.");
      return;
    }

    configurationInFlight.current = kind;
    setConfiguring(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await desktopBridge.configureVoiceRuntimeFile(kind);
      if (result.cancelled) return;

      await apiRequest("POST", "/api/voice/setup/refresh");
      const [readiness] = await Promise.all([
        setupQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["/api/voice/providers"] }),
      ]);
      if (readiness.isError || !readiness.data) {
        setError("Voice file selection may have been saved, but readiness could not be verified. Retry the read-only check before recording.");
        return;
      }
      setNotice("Voice file selection saved. Readiness was checked; see each component's status below.");
    } catch {
      // Native and server errors can include private local file paths or host diagnostics.
      setError("Could not confirm voice setup. The file selection may have been saved; use Retry readiness or choose the file again.");
    } finally {
      configurationInFlight.current = null;
      setConfiguring(null);
    }
  }

  // Cached data after a failed read is not evidence of current runtime health.
  const setup = setupQuery.isError ? undefined : setupQuery.data;
  const overallStatus = setupQuery.isLoading
    ? "CHECKING"
    : setupQuery.isError
      ? "UNAVAILABLE"
      : setup?.recordingReady
        ? "READY"
        : setup?.transcriptionProviderReady
          ? "NEEDS FFMPEG"
          : "OPTIONAL SETUP";

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-4" data-testid="connection-local-voice-settings">
      <div className="flex items-center gap-2">
        <Mic aria-hidden="true" className="h-5 w-5 text-foreground" />
        <h3 className="font-ui text-base font-semibold text-foreground">Local Voice Runtime</h3>
        <span className={`ml-auto rounded-md border border-border/60 px-2 py-1 font-ui text-xs font-semibold ${overallStatus === "READY" ? "text-emerald-400" : overallStatus === "UNAVAILABLE" ? "text-destructive" : "text-muted-foreground"}`} role="status">
          {overallStatus}
        </span>
      </div>
      <p className="font-ui text-sm leading-6 text-muted-foreground">
        Bring a whisper.cpp executable and model. Microphone recordings are commonly WebM, so ffmpeg is needed to convert them for local transcription. LiOS stores only the selected local paths; it does not copy, upload or silently download these files.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {RUNTIME_FILES.map(({ kind, label, statusKey }) => {
          const fileStatus = setup?.[statusKey];
          const available = fileStatus?.available === true;
          return (
            <div key={kind} className="rounded-lg border border-border/60 bg-background/60 p-3">
              <div className="flex items-center gap-2">
                {setup ? (available ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-400" /> : <XCircle aria-hidden="true" className="h-4 w-4 text-muted-foreground" />) : null}
                <span className="font-ui text-sm font-medium text-foreground">{label}</span>
              </div>
              <div className="mt-2 break-words font-ui text-xs leading-5 text-muted-foreground">
                {setupQuery.isLoading ? "Checking…" : setupQuery.isError ? "Status unavailable" : available ? fileStatus?.name : setup ? "Not configured" : "Not checked"}
              </div>
              <button
                type="button"
                onClick={() => void configureRuntimeFile(kind)}
                disabled={!desktopBridge?.configureVoiceRuntimeFile || configuring !== null}
                aria-busy={configuring === kind}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-3 py-2 font-ui text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`${available ? "Change" : "Choose"} ${label}`}
              >
                {configuring === kind ? "Selecting…" : available ? "Change file" : "Choose file"}
              </button>
            </div>
          );
        })}
      </div>

      {!desktopBridge?.configureVoiceRuntimeFile && (
        <p className="font-ui text-xs leading-5 text-muted-foreground">
          Native file selection requires the installed desktop app. For a development or managed runtime, set LIOS_WHISPER_CPP_BIN, LIOS_WHISPER_MODEL and LIOS_FFMPEG_BIN on the runtime host; these settings are not uploaded from this screen.
        </p>
      )}
      {setup?.transcriptionProviderReady && !setup.recordingReady && (
        <p className="font-ui text-sm leading-5 text-muted-foreground">Whisper is ready for WAV input, but microphone recording conversion is not ready until ffmpeg is configured.</p>
      )}
      {setup?.recordingReady && (
        <p className="font-ui text-sm leading-5 text-foreground">Microphone transcription is ready. Registered transcription providers: {setup.transcriptionProviders.join(", ") || "none"}.</p>
      )}
      {setupQuery.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="font-ui text-sm text-destructive">Voice readiness could not be checked. Other LiOS capabilities remain available.</p>
          <button type="button" disabled={setupQuery.isFetching} aria-busy={setupQuery.isFetching}
            onClick={() => void setupQuery.refetch()}
            className="min-h-11 rounded-lg border border-border px-3 py-2 font-ui text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
            {setupQuery.isFetching ? "Checking readiness…" : "Retry readiness (read-only)"}
          </button>
        </div>}
      <p className="font-ui text-sm leading-5 text-muted-foreground">Speech output remains opt-in. Available speech providers: {setup ? (setup.speechProviders.join(", ") || "none detected") : "not verified"}.</p>
      {error && <p className="font-ui text-sm text-destructive" role="alert">{error}</p>}
      {notice && <p className="font-ui text-sm text-foreground" role="status">{notice}</p>}
    </section>
  );
}
