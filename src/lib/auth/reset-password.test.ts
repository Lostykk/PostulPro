import { describe, it, expect } from "vitest";
import { resetPasswordRedirectTo } from "./reset-password";

describe("resetPasswordRedirectTo", () => {
  it("builds the redirect from the given origin in production", () => {
    expect(resetPasswordRedirectTo("https://postulpro.com")).toBe(
      "https://postulpro.com/auth/reset-password",
    );
  });

  it("builds the redirect from the given origin on the preview worker", () => {
    expect(
      resetPasswordRedirectTo("https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev"),
    ).toBe("https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/auth/reset-password");
  });

  it("builds the redirect from the given origin on localhost", () => {
    expect(resetPasswordRedirectTo("http://localhost:3000")).toBe(
      "http://localhost:3000/auth/reset-password",
    );
  });

  it("never hardcodes a domain — redirect always tracks the passed origin", () => {
    expect(resetPasswordRedirectTo("https://example.test")).toBe(
      "https://example.test/auth/reset-password",
    );
  });
});
