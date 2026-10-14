import { useState } from "react";
import { Terminal, Mail, Building2, MessageSquare, User, CheckCircle2, ArrowRight, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The one genuinely public, unauthenticated page in this app -- rendered
 * directly by App.tsx before any session check, since a prospect browsing
 * this has no account yet. Deliberately light: a short pitch plus a lead
 * form posting to /api/public/leads (server/publicRoutes.ts). P10 adds a
 * deliberately static/read-only guided product demonstration: no live data,
 * authenticated Project state, connectors, or AI/provider calls are exposed.
 */
const PILLARS = [
  {
    title: "Deterministic finance, governed AI",
    body: "LiOS uses deterministic engines as the authority for financial calculations. Connected AI can retrieve, orchestrate, explain and challenge the work; with explicit permission it may also produce clearly labelled AI-derived estimates or exploratory calculations.",
  },
  {
    title: "Finance-first intelligence",
    body: "LiOS launches around market data, fundamentals, valuation, portfolio and risk, fixed income, derivatives, macro and FX, alternatives, corporate actions, research and personal finance -- without turning those capabilities into menu clutter.",
  },
  {
    title: "Built for governed financial work",
    body: "Projects, conversations, evidence-linked artifacts, local-first data custody, reproducibility and explicit permissions keep professional analysis inspectable from first question through saved output.",
  },
];

const DEMO_STEPS = [
  {
    id: "connect",
    title: "Connect your data",
    body: "In the real Terminal, Connection Center lets the user bring their own files, providers and credentials. The demonstration never asks for a key and never touches an external provider.",
    preview: ["PROJECT · Example Research Workspace", "DATA · Bring-your-own source", "CUSTODY · User/local by default"],
  },
  {
    id: "ask",
    title: "Ask in Project context",
    body: "A Project chat carries the active entity, resources and permission boundary. LiOS plans the request, routes authoritative finance calculations to deterministic engines, and keeps any permissioned AI-derived estimates explicitly labelled.",
    preview: ["ASK · Refresh the thesis against new evidence", "MODE · Governed execution", "APPROVALS · Explicit for high-impact actions"],
  },
  {
    id: "analyze",
    title: "Inspect evidence and models",
    body: "Results remain linked to sources, deterministic engines, Artifacts and the Ledger. Missing data stays missing; the demo intentionally avoids fabricated market numbers.",
    preview: ["OUTPUT · Evidence-linked analysis", "ENGINE · Deterministic calculation", "LINEAGE · Source → transform → Artifact"],
  },
  {
    id: "automate",
    title: "Save the workflow",
    body: "P9 Continuous Intelligence can rerun an approved analysis on a schedule or supported event, suppress unchanged/noisy notifications, and preserve reproducibility references.",
    preview: ["WORKFLOW · Saved analysis", "TRIGGER · Schedule / supported event", "NOTIFY · Material change only"],
  },
] as const;

export default function ExperienceCenter() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [demoStep, setDemoStep] = useState(0);

  const handleSubmit = async () => {
    setError("");
    if (!name.trim()) return setError("Name is required.");
    if (!email.trim() || !email.includes("@")) return setError("A valid email address is required.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          company: company.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.formErrors?.[0] || data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#030303] text-foreground font-terminal">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] pointer-events-none fixed" />

      <div className="relative max-w-5xl mx-auto px-6 py-16 md:py-24">
        <div className="flex items-center gap-2 mb-10">
          <div className="w-9 h-9 rounded-full border border-border flex items-center justify-center bg-[#0d0d0d]">
            <Terminal className="w-4 h-4 text-[hsl(38,95%,50%)]" />
          </div>
          <span className="text-sm font-bold uppercase tracking-widest text-[hsl(38,95%,55%)]">
            Limuria Intelligence
          </span>
        </div>

        <h1 className="text-2xl md:text-4xl font-bold tracking-tight mb-4 max-w-2xl">
          A conversational financial intelligence terminal, built around your data and decisions.
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl mb-14 leading-relaxed">
          LiOS combines deterministic finance engines with governed, provider-neutral AI and evidence-linked live artifacts.
          Request access to see the product workflow.
        </p>

        <div className="grid md:grid-cols-3 gap-4 mb-16">
          {PILLARS.map((p) => (
            <Card key={p.title} className="bg-[#070707] border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-widest text-[hsl(38,95%,55%)]">
                  {p.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-[11px] leading-relaxed text-muted-foreground">
                  {p.body}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        <section className="mb-16" data-experience-demo="read-only">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
            <div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[hsl(38,95%,55%)] mb-2">
                <ShieldCheck className="w-3.5 h-3.5" />
                Read-only guided demo · 5–10 minutes
              </div>
              <h2 className="text-xl md:text-2xl font-bold tracking-tight">See the LiOS working loop before you connect anything.</h2>
              <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                This Experience Center uses static explanatory fixtures only. It makes no provider calls, stores no Project data, and does not present illustrative values as live financial data.
              </p>
            </div>
            <span className="rounded border border-emerald-400/25 bg-emerald-400/[0.04] px-2.5 py-1 font-terminal text-[8px] uppercase tracking-wider text-emerald-300">
              No login · no API key · no live data
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <div className="space-y-2" role="tablist" aria-label="LiOS guided demonstration steps">
              {DEMO_STEPS.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  role="tab"
                  aria-selected={demoStep === index}
                  onClick={() => setDemoStep(index)}
                  className={`w-full rounded border px-3 py-3 text-left transition-colors ${demoStep === index ? "border-[hsl(38,95%,50%)]/45 bg-[hsl(38,95%,50%)]/[0.06]" : "border-border bg-[#070707] hover:bg-[#0b0b0b]"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[8px] text-[hsl(38,95%,55%)]">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[10px] font-semibold">{step.title}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="rounded border border-border bg-[#060606] min-h-[280px] overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Experience Center · static fixture</span>
                <span className="text-[8px] text-[hsl(38,95%,55%)]">STEP {demoStep + 1}/{DEMO_STEPS.length}</span>
              </div>
              <div className="p-5">
                <h3 className="text-lg font-semibold">{DEMO_STEPS[demoStep].title}</h3>
                <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">{DEMO_STEPS[demoStep].body}</p>
                <div className="mt-5 rounded border border-border bg-[#030303] p-4" aria-label="Static terminal demonstration preview">
                  {DEMO_STEPS[demoStep].preview.map((line) => (
                    <div key={line} className="py-1.5 font-terminal text-[9px] tracking-wide text-emerald-300/90">
                      <span className="mr-2 text-muted-foreground">&gt;</span>{line}
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between">
                  <span className="text-[9px] text-muted-foreground">Static explanation only · real work happens after authenticated installation.</span>
                  {demoStep < DEMO_STEPS.length - 1 ? (
                    <button type="button" onClick={() => setDemoStep((current) => Math.min(current + 1, DEMO_STEPS.length - 1))} className="flex items-center gap-1.5 text-[9px] font-semibold text-[hsl(38,95%,55%)] hover:text-[hsl(38,95%,65%)]">
                      Next step <ArrowRight className="w-3 h-3" />
                    </button>
                  ) : (
                    <button type="button" onClick={() => setDemoStep(0)} className="text-[9px] font-semibold text-[hsl(38,95%,55%)] hover:text-[hsl(38,95%,65%)]">
                      Replay demo
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <Card className="max-w-lg bg-[#070707] border-border relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-[hsl(38,95%,50%)]" />
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-widest">Request Access</CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground">
              Tell us about your practice and we'll follow up to set up a walkthrough.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="flex items-start gap-2 py-4 text-emerald-400 text-xs">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Thanks -- we've received your request and will be in touch shortly.</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <User className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
                  <Input
                    placeholder="Full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-[#0d0d0d] border-border text-xs rounded-none pl-9 h-9"
                  />
                </div>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-[#0d0d0d] border-border text-xs rounded-none pl-9 h-9"
                  />
                </div>
                <div className="relative">
                  <Building2 className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
                  <Input
                    placeholder="Company (optional)"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="bg-[#0d0d0d] border-border text-xs rounded-none pl-9 h-9"
                  />
                </div>
                <div className="relative">
                  <MessageSquare className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
                  <Textarea
                    placeholder="What are you looking to solve? (optional)"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="bg-[#0d0d0d] border-border text-xs rounded-none pl-9 pt-2.5 min-h-[70px] resize-none"
                  />
                </div>

                {error && <p className="text-[10px] text-red-400">{error}</p>}

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmit}
                  className="w-full h-9 bg-[hsl(38,95%,50%)] text-black text-[10px] font-bold uppercase tracking-widest hover:bg-[hsl(38,95%,55%)] disabled:opacity-50 transition-colors"
                >
                  {submitting ? "Submitting..." : "Request Access"}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
