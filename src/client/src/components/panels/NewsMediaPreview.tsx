import * as React from "react";
import { useState } from "react";
import { safeNewsMediaPreview, type NewsMediaPreview as Preview } from "@shared/newsMediaPreview";

/** No remote video/audio request before the reader deliberately opens it. */
export function NewsMediaPreview({ preview }: { preview?: Preview }) {
  const [opened, setOpened] = useState(false);
  const safe = safeNewsMediaPreview(preview);
  if (!safe) return null;
  return <section data-testid="news-source-media-preview" className="my-4 rounded-xl border border-border/70 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-ui text-sm font-semibold text-foreground">{safe.kind === "video" ? "Publisher video" : "Publisher audio"}</span>
      <button type="button" aria-expanded={opened} onClick={() => setOpened(value => !value)}
        className="min-h-11 rounded-lg border border-amber-300/40 px-3 py-2 font-ui text-sm text-amber-100 focus-visible:outline-2 focus-visible:outline-amber-300">
        {opened ? "Close media preview" : "Load publisher media"}
      </button>
    </div>
    <p className="mt-2 font-ui text-xs leading-5 text-muted-foreground">
      RSS enclosure: playback streams directly from the publisher after your click. LiOS does not download, package or license this file.
    </p>
    {opened && (safe.kind === "video"
      ? <video controls playsInline preload="none" className="mt-3 aspect-video w-full bg-black">
          <source src={safe.url} type={safe.mime} />Your browser cannot play this publisher video.
        </video>
      : <audio controls preload="none" className="mt-3 w-full">
          <source src={safe.url} type={safe.mime} />Your browser cannot play this publisher audio.
        </audio>)}
    <a href={safe.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
      className="mt-2 inline-block break-all font-ui text-xs text-amber-200 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-amber-300">
      Open original media source
    </a>
  </section>;
}
