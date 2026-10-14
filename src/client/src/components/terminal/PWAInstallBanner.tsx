import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
    setDismissed(true);
  };

  return (
    <div
      data-testid="pwa-install-banner"
      className="flex items-center gap-3 border-b px-4 py-1.5 font-terminal text-xs"
      style={{
        background: "hsl(38 95% 50% / 15%)",
        borderColor: "hsl(38 95% 50% / 30%)",
      }}
    >
      <span className="text-[hsl(38,95%,60%)]">LiOS Desktop</span>
      <button
        onClick={handleInstall}
        className="ml-auto border border-[hsl(38,95%,50%)/60%] px-2 py-0.5 text-[9px] tracking-widest text-[hsl(38,95%,55%)] transition-colors hover:bg-[hsl(38,95%,50%)/20%]"
      >
        INSTALL
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
