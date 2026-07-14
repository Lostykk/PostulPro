import { describe, it, expect } from "vitest";
import {
  welcomeIdempotencyKey,
  lowCreditsIdempotencyKey,
  weeklySummaryIdempotencyKey,
  currentMonthPeriod,
  isoWeek,
} from "./idempotency";

describe("welcomeIdempotencyKey", () => {
  it("is stable per user and contains no PII beyond the user id", () => {
    expect(welcomeIdempotencyKey("user-123")).toBe("welcome/user-123");
  });

  it("produces the same key for repeated calls with the same user", () => {
    expect(welcomeIdempotencyKey("user-123")).toBe(welcomeIdempotencyKey("user-123"));
  });

  it("differs per user", () => {
    expect(welcomeIdempotencyKey("user-a")).not.toBe(welcomeIdempotencyKey("user-b"));
  });
});

describe("lowCreditsIdempotencyKey", () => {
  it("includes user, threshold and period so a new period resets the cooldown", () => {
    expect(lowCreditsIdempotencyKey("user-123", 20, "2026-07")).toBe(
      "low-credits/user-123/20/2026-07",
    );
  });

  it("differs across periods for the same user/threshold", () => {
    expect(lowCreditsIdempotencyKey("user-123", 20, "2026-07")).not.toBe(
      lowCreditsIdempotencyKey("user-123", 20, "2026-08"),
    );
  });
});

describe("weeklySummaryIdempotencyKey", () => {
  it("includes user and ISO week", () => {
    expect(weeklySummaryIdempotencyKey("user-123", "2026-W29")).toBe(
      "weekly-summary/user-123/2026-W29",
    );
  });
});

describe("currentMonthPeriod", () => {
  it("formats as YYYY-MM in UTC", () => {
    expect(currentMonthPeriod(new Date("2026-07-14T12:00:00Z"))).toBe("2026-07");
  });

  it("pads single-digit months", () => {
    expect(currentMonthPeriod(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01");
  });
});

describe("isoWeek", () => {
  it("formats as YYYY-Www", () => {
    expect(isoWeek(new Date("2026-07-14T12:00:00Z"))).toMatch(/^2026-W\d{2}$/);
  });

  it("is stable for two dates in the same ISO week", () => {
    const monday = isoWeek(new Date("2026-07-13T00:00:00Z"));
    const wednesday = isoWeek(new Date("2026-07-15T00:00:00Z"));
    expect(monday).toBe(wednesday);
  });

  it("differs across a week boundary", () => {
    const week1 = isoWeek(new Date("2026-07-12T00:00:00Z"));
    const week2 = isoWeek(new Date("2026-07-13T00:00:00Z"));
    expect(week1).not.toBe(week2);
  });
});
