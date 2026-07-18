import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  didCrossLowCreditsThreshold,
  remainingPercent,
  lowCreditsThresholdPercent,
  DEFAULT_LOW_CREDITS_THRESHOLD_PERCENT,
} from "./low-credits";

describe("remainingPercent", () => {
  it("computes the percentage of credits still available", () => {
    expect(remainingPercent(80, 100)).toBe(20);
  });

  it("clamps at 0 when used exceeds limit", () => {
    expect(remainingPercent(120, 100)).toBe(0);
  });

  it("returns 0 for a zero/invalid limit instead of dividing by zero", () => {
    expect(remainingPercent(10, 0)).toBe(0);
  });
});

describe("didCrossLowCreditsThreshold", () => {
  const threshold = 20;

  it("saldo por encima del umbral: no dispara", () => {
    // 100 limit, used 50 -> 15 (35 -> 65 remaining), stays well above 20%
    expect(didCrossLowCreditsThreshold(65, 100, 15, threshold)).toBe(false);
  });

  it("cruce del umbral: dispara exactamente cuando pasa de >=20% a <20%", () => {
    // before: used 75 of 100 -> 25% remaining (above); cost 10 -> used 85 -> 15% remaining (below)
    expect(didCrossLowCreditsThreshold(85, 100, 10, threshold)).toBe(true);
  });

  it("saldo ya debajo del umbral: no vuelve a disparar en la siguiente reserva", () => {
    // before: used 85 of 100 -> 15% remaining (already below); cost 5 -> used 90 -> 10%
    expect(didCrossLowCreditsThreshold(90, 100, 5, threshold)).toBe(false);
  });

  it("no dispara con límite inválido", () => {
    expect(didCrossLowCreditsThreshold(10, 0, 10, threshold)).toBe(false);
  });

  it("compra posterior de créditos sube el remaining y no cuenta como cruce", () => {
    // Simulates the state right after a credit top-up: remaining jumps back up.
    // A subsequent small reservation that stays above threshold must not fire.
    expect(didCrossLowCreditsThreshold(20, 200, 5, threshold)).toBe(false);
  });
});

describe("lowCreditsThresholdPercent", () => {
  const original = process.env.LOW_CREDITS_THRESHOLD_PERCENT;

  afterEach(() => {
    if (original === undefined) delete process.env.LOW_CREDITS_THRESHOLD_PERCENT;
    else process.env.LOW_CREDITS_THRESHOLD_PERCENT = original;
  });

  it("falls back to the documented default when unset", () => {
    delete process.env.LOW_CREDITS_THRESHOLD_PERCENT;
    expect(lowCreditsThresholdPercent()).toBe(DEFAULT_LOW_CREDITS_THRESHOLD_PERCENT);
  });

  it("uses a valid configured value", () => {
    process.env.LOW_CREDITS_THRESHOLD_PERCENT = "15";
    expect(lowCreditsThresholdPercent()).toBe(15);
  });

  it("falls back to the default for an out-of-range value", () => {
    process.env.LOW_CREDITS_THRESHOLD_PERCENT = "150";
    expect(lowCreditsThresholdPercent()).toBe(DEFAULT_LOW_CREDITS_THRESHOLD_PERCENT);
  });

  it("falls back to the default for a non-numeric value", () => {
    process.env.LOW_CREDITS_THRESHOLD_PERCENT = "abc";
    expect(lowCreditsThresholdPercent()).toBe(DEFAULT_LOW_CREDITS_THRESHOLD_PERCENT);
  });
});
