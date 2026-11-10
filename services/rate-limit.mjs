export class FixedWindowRateLimiter {
  constructor({ limit, windowMs }) {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1_000) {
      throw new Error("invalid rate limiter configuration");
    }
    this.limit = limit;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  take(key, now = Date.now()) {
    const existing = this.entries.get(key);
    const entry = !existing || now >= existing.resetAt
      ? { count: 0, resetAt: now + this.windowMs }
      : existing;
    entry.count++;
    this.entries.set(key, entry);
    if (this.entries.size > 10_000) {
      for (const [candidate, value] of this.entries) {
        if (now >= value.resetAt) this.entries.delete(candidate);
      }
    }
    return {
      allowed: entry.count <= this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      resetAt: entry.resetAt,
    };
  }
}
