import { describe, it, expect } from "vitest";
import { googleOAuthOptions, parseOAuthCallbackError } from "./google-oauth";

describe("googleOAuthOptions", () => {
  it("always uses the native Supabase google provider", () => {
    expect(googleOAuthOptions("https://postulpro.com").provider).toBe("google");
  });

  it("builds redirectTo from the given origin in production", () => {
    expect(googleOAuthOptions("https://postulpro.com").options.redirectTo).toBe(
      "https://postulpro.com/auth/callback",
    );
  });

  it("builds redirectTo from the given origin on the preview worker", () => {
    expect(
      googleOAuthOptions("https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev").options
        .redirectTo,
    ).toBe("https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/auth/callback");
  });

  it("builds redirectTo from the given origin on localhost", () => {
    expect(googleOAuthOptions("http://localhost:3000").options.redirectTo).toBe(
      "http://localhost:3000/auth/callback",
    );
  });

  it("never hardcodes a domain — redirectTo always tracks the passed origin", () => {
    expect(googleOAuthOptions("https://example.test").options.redirectTo).toBe(
      "https://example.test/auth/callback",
    );
  });
});

describe("parseOAuthCallbackError", () => {
  it("returns null when the callback URL carries no error", () => {
    expect(parseOAuthCallbackError("")).toBeNull();
  });

  it("returns null for an unrelated query string", () => {
    expect(parseOAuthCallbackError("?foo=bar")).toBeNull();
  });

  it("extracts and decodes error_description when present", () => {
    expect(
      parseOAuthCallbackError("?error=access_denied&error_description=User+denied+access"),
    ).toBe("User denied access");
  });

  it("falls back to the raw error code when error_description is absent", () => {
    expect(parseOAuthCallbackError("?error=server_error")).toBe("server_error");
  });
});
