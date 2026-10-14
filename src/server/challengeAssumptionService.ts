import { invokeAIRoutedCompletion } from "./byoaiTransport";

/**
 * "Challenge My Assumptions" -- Consultant Copilot, reframed (Major Bet,
 * Roadmap Rev.3 §10): "A consultant enters an assumption ('revenue grows
 * 15%'); AI doesn't change the number, it asks what supports it, what
 * invalidates it, what happens at 10%/5% -- then the quant engine tests the
 * alternatives. AI as devil's advocate, not calculator." The quant-engine
 * half (recomputing the DCF worksheet at each tested value) happens entirely
 * client-side in ValuationPanel.tsx, reusing the exact same computation the
 * live worksheet and sensitivity grid already use -- this service only ever
 * sees the already-computed results, never raw financials, and never
 * proposes a number of its own.
 *
 * Uses the shared BYOAI registry and routing policy.
 */
export interface AssumptionTestResult {
  testedValue: string;
  outputLabel: string;
  outputValue: string;
}

export async function getAssumptionChallenge(
  assumptionLabel: string,
  assumptionValue: string,
  results: AssumptionTestResult[],
): Promise<string> {
  const resultsText = results.map((r) => `- If ${assumptionLabel} = ${r.testedValue}: ${r.outputLabel} = ${r.outputValue}`).join("\n");
  const prompt = `You are a skeptical senior consultant reviewing a colleague's assumption in a financial model. You do not have access to the underlying data and you cannot change or recompute anything -- only the already-computed sensitivity results below.

Assumption under review: ${assumptionLabel} = ${assumptionValue}

What the model actually produces if that assumption were different instead:
${resultsText}

In 2-3 short sentences (max 60 words total), play devil's advocate: name one concrete thing that would need to be true for the stated assumption to hold, one thing that would invalidate it, and note how sensitive the output actually is across the tested range above. No preamble, no markdown, no restating the numbers verbatim.`;

  const result = await invokeAIRoutedCompletion({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 180,
  });
  const text = result.text.trim();
  if (!text) throw new Error("Configured AI providers returned empty output.");
  return text;
}
