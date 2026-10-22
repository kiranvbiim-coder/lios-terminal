import { ArrowLeft, Compass } from "lucide-react";

/** A safe route fallback: never exposes technical router internals to users. */
export default function NotFound() {
  return (
    <main className="dark flex min-h-screen w-full items-center justify-center bg-[#050505] px-4 py-10 font-ui text-foreground">
      <section aria-labelledby="lios-not-found-title" className="w-full max-w-lg rounded-xl border border-border bg-[#090909] p-6 shadow-xl sm:p-8">
        <div className="mb-5 flex items-center gap-3 text-primary">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/5">
            <Compass className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-ui text-sm font-semibold tracking-wide">LiOS</span>
        </div>
        <h1 id="lios-not-found-title" className="font-ui text-2xl font-semibold tracking-tight">We couldn't find that view</h1>
        <p className="mt-3 font-ui text-sm leading-6 text-muted-foreground">
          The link may be outdated or the destination may no longer be available. You can return to your conversations and continue working.
        </p>
        <a
          href="#/"
          className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-ui text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to LiOS Chat
        </a>
      </section>
    </main>
  );
}
