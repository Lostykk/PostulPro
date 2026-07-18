import { describe, expect, it } from "vitest";
import { landingImagePathFromUrl, validateLandingImage } from "@/lib/landing/images";

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

describe("landingImagePathFromUrl", () => {
  it("extracts the owner-scoped path from a real Supabase public URL", () => {
    const url =
      "https://ccpejnklrfvgtwryqfrw.supabase.co/storage/v1/object/public/landing-images/abc-123/1234-xy9z.png";
    expect(landingImagePathFromUrl(url)).toBe("abc-123/1234-xy9z.png");
  });

  it("strips query/hash suffixes and decodes the path", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/landing-images/u1/my%20file.png?t=1";
    expect(landingImagePathFromUrl(url)).toBe("u1/my file.png");
  });

  it("returns null for URLs outside our bucket (e.g. a pasted external URL)", () => {
    expect(landingImagePathFromUrl("https://ejemplo.com/imagen-hero-seguros.jpg")).toBeNull();
  });

  it("returns null when the bucket marker is present but nothing follows it", () => {
    expect(landingImagePathFromUrl("https://x.supabase.co/storage/v1/object/public/landing-images/")).toBeNull();
  });
});
