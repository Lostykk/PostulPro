import { describe, expect, it } from "vitest";
import { validateLandingImage } from "@/lib/landing/images";

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], "test", { type });
}

describe("validateLandingImage", () => {
  it("accepts allowed image types under the size limit", () => {
    expect(validateLandingImage(makeFile("image/png", 1024))).toBeNull();
    expect(validateLandingImage(makeFile("image/jpeg", 1024))).toBeNull();
    expect(validateLandingImage(makeFile("image/webp", 1024))).toBeNull();
    expect(validateLandingImage(makeFile("image/gif", 1024))).toBeNull();
  });

  it("rejects SVG (stored-XSS vector) even though it's an image type", () => {
    expect(validateLandingImage(makeFile("image/svg+xml", 1024))).toMatch(/no soportado/i);
  });

  it("rejects non-image types", () => {
    expect(validateLandingImage(makeFile("application/pdf", 1024))).toMatch(/no soportado/i);
  });

  it("rejects files over 5 MB", () => {
    expect(validateLandingImage(makeFile("image/png", 6 * 1024 * 1024))).toMatch(/5 MB/);
  });

  it("accepts a file right at the boundary", () => {
    expect(validateLandingImage(makeFile("image/png", 5 * 1024 * 1024))).toBeNull();
  });
});
