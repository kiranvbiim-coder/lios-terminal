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
    <section className="border border-border/60 bg-black/20 p-3 space-y-3" data-testid="connection-local-voice-settings">
      <div className="flex items-center gap-2">
        <Mic className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
        <h3 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Local Voice Runtime</h3>
        <span className={`ml-auto font-terminal text-[8px] ${overallStatus === "READY" ? "text-emerald-400" : overallStatus === "UNAVAILABLE" ? "text-rose-300" : "text-amber-300"}`} role="status">
          {overallStatus}
        </span>
      </div>
      <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">
        Bring a whisper.cpp executable and model. Microphone recordings are commonly WebM, so ffmpeg is needed to convert them for local transcription. LiOS stores only the selected local paths; it does not copy, upload or silently download these files.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {RUNTIME_FILES.map(({ kind, label, statusKey }) => {
          const fileStatus = setup?.[statusKey];
          const available = fileStatus?.available === true;
          return (
            <div key={kind} className="border border-border/60 bg-[#090909] p-2.5">
              <div className="flex items-center gap-1.5">
                {available ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-amber-300" />}
                <span className="font-terminal text-[8px] text-foreground">{label}</span>
              </div>
              <div className="mt-1 truncate font-terminal text-[7px] text-muted-foreground">
                {setupQuery.isLoading ? "Checking…" : setupQuery.isError ? "Status unavailable" : available ? fileStatus?.name : "Not configured"}
              </div>
              <button
                type="button"
                onClick={() => void configureRuntimeFile(kind)}
                disabled={!desktopBridge?.configureVoiceRuntimeFile || configuring !== null}
                className="mt-2 border border-border px-2 py-1 font-terminal text-[7px] uppercase text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`${available ? "Change" : "Choose"} ${label}`}
              >
                {configuring === kind ? "Selecting…" : available ? "Change file" : "Choose file"}
              </button>
            </div>
          );
        })}
      </div>

      {!desktopBridge?.configureVoiceRuntimeFile && (
        <p className="font-terminal text-[7px] leading-relaxed text-muted-foreground">
          Native file selection requires the installed desktop app. For a development or managed runtime, set LIOS_WHISPER_CPP_BIN, LIOS_WHISPER_MODEL and LIOS_FFMPEG_BIN on the runtime host; these settings are not uploaded from this screen.
        </p>
      )}
      {setup?.transcriptionProviderReady && !setup.recordingReady && (
        <p className="font-terminal text-[7px] text-amber-300">Whisper is ready for WAV input, but microphone recording conversion is not ready until ffmpeg is configured.</p>
      )}
      {setup?.recordingReady && (
        <p className="font-terminal text-[7px] text-emerald-300">Microphone transcription is ready. Registered transcription providers: {setup.transcriptionProviders.join(", ") || "none"}.</p>
      )}
      {setupQuery.isError && <p className="font-terminal text-[7px] text-rose-300">Voice readiness could not be checked. Other LiOS terminal capabilities remain available.</p>}
      <p className="font-terminal text-[7px] text-muted-foreground">Speech output remains opt-in. Available speech providers: {setup?.speechProviders.join(", ") || "none detected"}.</p>
      {error && <p className="font-terminal text-[8px] text-rose-300" role="alert">{error}</p>}
      {notice && <p className="font-terminal text-[8px] text-emerald-300" role="status">{notice}</p>}
    </section>
  );
}
