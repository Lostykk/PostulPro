// Pure, dependency-free idempotency-key builders for app-triggered
// transactional emails. Never include an email address or any other PII in
// the key — user_id (already an opaque UUID) is the only identifying part,
// and it's never exposed outside the notifications ledger.

export function welcomeIdempotencyKey(userId: string): string {
  return `welcome/${userId}`;
}

// period is the natural cooldown: crossing the threshold fires at most once
// per period even if usage fluctuates around it (e.g. buy credits, cross
// back under threshold, use them, cross again).
export function lowCreditsIdempotencyKey(
  userId: string,
  thresholdPercent: number,
  period: string,
): string {
  return `low-credits/${userId}/${thresholdPercent}/${period}`;
}

export function weeklySummaryIdempotencyKey(userId: string, isoWeek: string): string {
  return `weekly-summary/${userId}/${isoWeek}`;
}

// "YYYY-MM" in UTC — used as the low-credits cooldown period.
export function currentMonthPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// ISO 8601 week ("YYYY-Www"), UTC-based. Used as the weekly-summary
// idempotency period so at most one summary can ever be claimed per week
// per user, regardless of how many times a trigger fires.
export function isoWeek(now: Date = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO week: Thursday of the current week determines the week-year.
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
