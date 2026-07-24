const EXISTING_USER_CODES = new Set([
  "email_exists",
  "user_already_exists",
  "user_already_registered",
]);

export function isExistingUserError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  const code = typeof value.code === "string" ? value.code.toLowerCase() : "";
  if (EXISTING_USER_CODES.has(code)) return true;
  if (typeof value.message !== "string") return false;
  return /\b(?:user|email(?: address)?)\b.*\balready(?:\s+been)?\s+(?:registered|exists)\b/i.test(
    value.message,
  );
}
