/**
 * Per-user rate limiting, in process memory.
 *
 * READ THIS BEFORE RELYING ON IT.
 *
 * Memory is per instance. On Vercel that means per serverless function
 * instance, and instances scale horizontally — so the real ceiling is
 * (limit × instance count), not (limit). It also resets on every cold start.
 *
 * That makes this useful for two things and nothing else:
 *   - stopping a single runaway client or a buggy retry loop in a long-lived
 *     process, which is exactly the dev and preview case
 *   - making the limit a named, testable thing rather than an intention
 *
 * It is NOT a defence against a determined attacker, and it should be swapped
 * for a shared store (Upstash, Vercel KV) before production. The call sites
 * don't change when that happens — only this file does.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound in a long-lived dev server. */
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets. Suitable for a Retry-After header. */
  retryAfter: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      for (const [k, bucket] of buckets) {
        if (now >= bucket.resetAt) buckets.delete(k);
      }
      // Still full of live buckets: drop the oldest rather than grow.
      if (buckets.size >= MAX_TRACKED_KEYS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  return { allowed: true, retryAfter: 0 };
}
