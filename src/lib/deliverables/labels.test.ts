import { describe, expect, it } from "vitest";
import { socialChannelLabel, socialFormatLabel } from "@/lib/deliverables/labels";

describe("social labels", () => {
  it("maps ALL-CAPS block titles as documented", () => {
    expect(socialChannelLabel("YOUTUBE")).toBe("YouTube");
    expect(socialFormatLabel("YOUTUBE")).toBe("Guion de video");
  });

  // Regression: a real production generation (project
  // bcc36718-3e2c-429e-80bc-d5b21ad4de5c) used mixed-case block titles
  // ("LinkedIn", "YouTube") instead of the requested ALL-CAPS convention —
  // a case-sensitive lookup fell back to the generic default and mislabeled
  // an actual video script as plain "Copy".
  it("is case-insensitive so real mixed-case titles still map correctly", () => {
    expect(socialChannelLabel("YouTube")).toBe("YouTube");
    expect(socialFormatLabel("YouTube")).toBe("Guion de video");
    expect(socialChannelLabel("LinkedIn")).toBe("LinkedIn");
    expect(socialFormatLabel("LinkedIn")).toBe("Copy");
  });

  it("falls back to the raw title / generic format for unknown channels", () => {
    expect(socialChannelLabel("TIKTOK")).toBe("TIKTOK");
    expect(socialFormatLabel("TIKTOK")).toBe("Copy");
  });
});
