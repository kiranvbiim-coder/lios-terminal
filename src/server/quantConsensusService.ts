import { invokeAIRoutedCompletion } from "./byoaiTransport";

/**
 * Backs the Model Consensus panel's AI note (client/src/components/quant/
 * ModelConsensus.tsx) -- the one place in that mechanism where AI touches
 * anything at all. It reads already-computed, already-final verdicts from
 * independent deterministic methods and writes ONE short sentence about
 * whether they agree, per the roadmap's "AI validates, it never calculates"
 * doctrine. It never sees raw financials and cannot influence any score.
 *
 * Uses the shared BYOAI registry and routing policy, non-streaming since this
 * is a one-sentence response, not a conversation.
 */
export interface ConsensusMethodInput {
  name: string;
  value: string;
  verdict: string;
}

export async function getConsensusNote(question: string, methods: ConsensusMethodInput[]): Promise<string> {
  const methodsText = methods.map((m) => `- ${m.name}: ${m.value} (${m.verdict})`).join("\n");
  const prompt = `You are a financial analyst reading the output of ${methods.length} independent, already-computed quantitative models. You do not calculate anything and you do not have access to the underlying financial data -- only the verdicts below.

Question: ${question}

Model verdicts:
${methodsText}

Write exactly ONE sentence (max 30 words) stating whether these models agree or disagree, and if they disagree, which one is the outlier and why that's worth a second look. Do not restate every verdict -- synthesize. No preamble, no markdown, just the sentence.`;

  const result = await invokeAIRoutedCompletion({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 120,
  });
  const text = result.text.trim();
  if (!text) throw new Error("Configured AI providers returned empty output.");
  return text;
}
