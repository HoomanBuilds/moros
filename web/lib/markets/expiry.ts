export const MIN_MARKET_LEAD_SECONDS = 15 * 60;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toLocalDateTimeValue(date: Date): string {
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

export function presetExpiryLocal(durationSeconds: number, nowMs = Date.now()): string {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < MIN_MARKET_LEAD_SECONDS) {
    throw new Error("Invalid settlement shortcut");
  }
  const targetMs = Math.ceil((nowMs + durationSeconds * 1000) / 60_000) * 60_000;
  return toLocalDateTimeValue(new Date(targetMs));
}

export function parseMarketExpiry(value: string, nowMs = Date.now()): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Choose an exact settlement date and time");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || toLocalDateTimeValue(date) !== value) {
    throw new Error("Choose a valid local date and time");
  }
  const expiryUnix = Math.floor(date.getTime() / 1000);
  const nowUnix = Math.floor(nowMs / 1000);
  if (expiryUnix < nowUnix + MIN_MARKET_LEAD_SECONDS) {
    throw new Error("Settlement must be at least 15 minutes from now");
  }
  return expiryUnix;
}

export function marketExpiryError(value: string, nowMs = Date.now()): string {
  try {
    parseMarketExpiry(value, nowMs);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Choose a valid settlement time";
  }
}
