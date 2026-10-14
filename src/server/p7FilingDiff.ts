import { P7_SCHEMA_VERSION, p7FilingDiffSchema, type P7FilingDiff } from "@shared/p7ResearchContracts";

export interface FilingSectionInput {
  id: string;
  title: string;
  text: string;
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

function lineDelta(before: string[], after: string[]): { addedLines: string[]; removedLines: string[] } {
  if (before.length * after.length > 1_000_000) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return {
      addedLines: after.filter((line) => !beforeSet.has(line)).slice(0, 5_000),
      removedLines: before.filter((line) => !afterSet.has(line)).slice(0, 5_000),
    };
  }
  const dp = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const addedLines: string[] = [];
  const removedLines: string[] = [];
  let i = 0, j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) { i += 1; j += 1; continue; }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      removedLines.push(before[i]);
      i += 1;
    } else {
      addedLines.push(after[j]);
      j += 1;
    }
  }
  while (i < before.length) removedLines.push(before[i++]);
  while (j < after.length) addedLines.push(after[j++]);
  return { addedLines: addedLines.slice(0, 5_000), removedLines: removedLines.slice(0, 5_000) };
}

function excerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 8_000);
}

export function comparePrimarySourceFilings(input: {
  priorRef: string;
  filingRef: string;
  priorSections: FilingSectionInput[];
  currentSections: FilingSectionInput[];
  generatedAt?: string;
}): P7FilingDiff {
  const prior = new Map(input.priorSections.map((section) => [section.id, section]));
  const current = new Map(input.currentSections.map((section) => [section.id, section]));
  const addedSections = input.currentSections.filter((section) => !prior.has(section.id));
  const removedSections = input.priorSections.filter((section) => !current.has(section.id));
  const changedSections: P7FilingDiff["changedSections"] = [];
  let unchangedSectionCount = 0;

  for (const section of input.currentSections) {
    const before = prior.get(section.id);
    if (!before) continue;
    if (before.text === section.text && before.title === section.title) {
      unchangedSectionCount += 1;
      continue;
    }
    const delta = lineDelta(lines(before.text), lines(section.text));
    if (!delta.addedLines.length && !delta.removedLines.length && before.title === section.title) {
      unchangedSectionCount += 1;
      continue;
    }
    changedSections.push({
      id: section.id,
      title: section.title,
      beforeExcerpt: excerpt(before.text),
      afterExcerpt: excerpt(section.text),
      addedLines: delta.addedLines,
      removedLines: delta.removedLines,
    });
  }

  const evidenceRefs = [
    input.priorRef,
    input.filingRef,
    ...addedSections.map((section) => input.filingRef + "#section:" + section.id),
    ...removedSections.map((section) => input.priorRef + "#section:" + section.id),
    ...changedSections.flatMap((section) => [
      input.priorRef + "#section:" + section.id,
      input.filingRef + "#section:" + section.id,
    ]),
  ];

  return p7FilingDiffSchema.parse({
    schemaVersion: P7_SCHEMA_VERSION,
    filingRef: input.filingRef,
    priorRef: input.priorRef,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    addedSections,
    removedSections,
    changedSections,
    unchangedSectionCount,
    evidenceRefs: [...new Set(evidenceRefs)],
  });
}
