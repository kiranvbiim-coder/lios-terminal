import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { getDesktopWorkspaceBridge, type DesktopDataFolder } from "@/lib/desktopWorkspace";
import { stripIpcErrorPrefix } from "@/lib/backupHealth";

const bridge = getDesktopWorkspaceBridge();

export default function DataFolderSettings() {
  const [folder, setFolder] = useState<DesktopDataFolder | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getDataFolder = bridge?.getDataFolder;

  useEffect(() => {
    if (!getDataFolder) return;
    void getDataFolder().then(setFolder).catch((cause) => setError(stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause))));
  }, [getDataFolder]);

  if (!bridge?.getDataFolder || !bridge.chooseFolder || !bridge.moveDataFolder) return null;
  const { chooseFolder, moveDataFolder } = bridge;

  async function pickTarget() {
    setError(null);
    try {
      const chosen = await chooseFolder!("data-folder");
      if (chosen) setTarget(chosen);
    } catch (cause) {
      setError(stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause)));
    }
  }

  async function confirmMove() {
    if (!target) return;
    setMoving(true);
    setError(null);
    try {
      await moveDataFolder!(target);
    } catch (cause) {
      setError(stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause)));
      setMoving(false);
    }
  }

  return (
    <section className="border border-border/60 bg-black/20 p-3 space-y-3" data-testid="connection-data-folder-settings">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
        <h3 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Data folder</h3>
      </div>

      <div className="space-y-1">
        <p className="font-terminal text-[8px] text-muted-foreground">Current folder{folder?.isDefault ? " (default)" : ""}</p>
        <p className="break-all font-terminal text-[8px] text-foreground" data-testid="data-folder-root">{folder?.root ?? "Checking…"}</p>
      </div>

      {target ? (
        <div className="space-y-2 border border-amber-500/30 p-2">
          <p className="break-all font-terminal text-[8px] text-foreground">{target}</p>
          <p className="font-terminal text-[8px] text-amber-200">
            LiOS will close, copy everything to {target}, verify it, and reopen. The old folder is kept until you delete it.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={moving} onClick={() => void confirmMove()}
              className="border border-amber-500/50 px-3 py-1 font-terminal text-[8px] uppercase tracking-wider text-amber-200 disabled:opacity-45">
              {moving ? "Moving…" : "Move and restart"}
            </button>
            <button type="button" disabled={moving} onClick={() => setTarget(null)}
              className="border border-border px-3 py-1 font-terminal text-[8px] uppercase tracking-wider text-muted-foreground disabled:opacity-45">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => void pickTarget()}
          className="border border-border px-3 py-1 font-terminal text-[8px] uppercase tracking-wider text-foreground hover:border-[hsl(38,95%,50%)/40%]">
          Move data folder…
        </button>
      )}
      {error && <p className="font-terminal text-[8px] text-rose-300" role="alert">{error}</p>}
    </section>
  );
}
