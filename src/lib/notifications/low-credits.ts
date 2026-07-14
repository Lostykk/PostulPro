// Pure crossing-detection for the low-credits email. "Crossing" (not merely
// "currently below") is what we want: a user who has been under the
// threshold all month must not get re-notified on every single generation
// they run — only the transition matters, and lowCreditsIdempotencyKey's
// per-period cooldown handles the rest.

// No product-defined threshold exists yet (see
// docs/production-environment-manifest.md) — this default is a placeholder
// pending an explicit product decision, not a number taken from an existing
// UI/copy. Configurable via env so it can be tuned without a code change.
export const DEFAULT_LOW_CREDITS_THRESHOLD_PERCENT = 20;

export function lowCreditsThresholdPercent(): number {
  const raw = process.env.LOW_CREDITS_THRESHOLD_PERCENT;
  if (!raw) return DEFAULT_LOW_CREDITS_THRESHOLD_PERCENT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) {
    return DEFAULT_LOW_CREDITS_THRESHOLD_PERCENT;
  }
  return parsed;
}

export function remainingPercent(creditsUsed: number, creditsLimit: number): number {
  if (creditsLimit <= 0) return 0;
  return Math.max(0, 100 - (creditsUsed / creditsLimit) * 100);
}

// creditsUsedAfter/creditsLimit come straight from reserve_credits' own
// return row (post-reservation state) — cost is the amount just reserved,
// so "before" is reconstructed as (after - cost) without an extra query.
export function didCrossLowCreditsThreshold(
  creditsUsedAfter: number,
  creditsLimit: number,
  cost: number,
  thresholdPercent: number,
): boolean {
  if (creditsLimit <= 0) return false;
  const before = remainingPercent(creditsUsedAfter - cost, creditsLimit);
  const after = remainingPercent(creditsUsedAfter, creditsLimit);
  return before >= thresholdPercent && after < thresholdPercent;
}
