/**
 * Password policy, shared between client (live validation + strength meter)
 * and server (the actual enforcement point -- the client check is a UX
 * convenience, never trust it alone). Chosen rules: 12+ characters and at
 * least 3 of the 4 character classes, plus a small blocklist of common weak
 * passwords and a check against the account's own email/name. Length still
 * does most of the work against brute force; the composition rule and
 * blocklist exist to catch the "aaaaaaaaaaaa" / "password1234" cases that
 * length alone lets through.
 */

export const PASSWORD_MIN_LENGTH = 12;

const COMMON_WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "password1234",
  "12345678", "123456789", "1234567890", "123456789012",
  "qwerty123", "qwertyuiop", "letmein123", "welcome123",
  "admin1234", "administrator", "iloveyou1", "abc123456",
  "changeme1", "changeme123", "trustno1", "monkey123",
  "dragon123", "football1", "baseball1", "sunshine1",
  "princess1", "starwars1", "master1234", "shadow123",
  "michael123", "superman1", "batman1234", "whatever1",
]);

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
  /** 0 (very weak) to 4 (strong) -- for a strength meter, independent of pass/fail. */
  score: number;
}

export function checkPasswordPolicy(
  password: string,
  context?: { email?: string; name?: string },
): PasswordPolicyResult {
  const errors: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const classesPresent = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  if (classesPresent < 3) {
    errors.push("Must include at least 3 of: lowercase, uppercase, number, symbol.");
  }

  const lower = password.toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(lower)) {
    errors.push("This password is too common -- pick something less guessable.");
  }

  const emailLocal = context?.email?.split("@")[0]?.toLowerCase().trim();
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    errors.push("Password can't contain your email address.");
  }
  const nameLower = context?.name?.toLowerCase().trim();
  if (nameLower && nameLower.length >= 3 && lower.includes(nameLower)) {
    errors.push("Password can't contain your name.");
  }

  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score++;
  if (password.length >= 16) score++;
  if (classesPresent >= 3) score++;
  if (classesPresent === 4) score++;
  if (errors.length > 0) score = Math.min(score, 1);

  return { valid: errors.length === 0, errors, score: Math.min(score, 4) };
}
