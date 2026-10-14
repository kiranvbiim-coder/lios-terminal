/**
 * Database and driver failures carry SQL text, bind parameters and internal
 * identifiers. Those belong in the local log, never in a user-visible message.
 */
const INTERNAL_DETAIL = [
  /^Failed query:/i,
  /\bparams:\s/i,
  /\b(?:insert into|update|delete from|select .+ from)\s+"?[a-z_]+"?/i,
  /violates (?:foreign key|unique|check|not-null) constraint/i,
  /relation "[^"]+" does not exist/i,
  /column "[^"]+" (?:of relation|does not exist)/i,
  /\bSQLSTATE\b/i,
];

export const DATABASE_FAILURE_MESSAGE =
  "LiOS could not save this work to its local database. Nothing was lost; try again, and restart LiOS if it keeps happening.";

export function isInternalDetail(message: string): boolean {
  return INTERNAL_DETAIL.some((pattern) => pattern.test(message));
}

/** Returns a message safe to show to a user; internal detail is replaced, not truncated. */
export function userSafeErrorMessage(error: unknown, fallback: string): string {
  const messages: string[] = [];
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      if (typeof current === "string") messages.push(current);
      break;
    }
  }
  if (messages.some(isInternalDetail)) return DATABASE_FAILURE_MESSAGE;
  const first = messages[0];
  return first && first.trim() ? first : fallback;
}
