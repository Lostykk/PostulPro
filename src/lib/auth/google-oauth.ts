// Pure helpers for native Supabase Google OAuth, kept dependency-free from
// window/router so they're unit-testable without a DOM environment.

export function googleOAuthOptions(origin: string) {
  return {
    provider: "google" as const,
    options: { redirectTo: `${origin}/auth/callback` },
  };
}

// Supabase redirects OAuth failures (denied consent, misconfigured
// provider, etc.) back to redirectTo as ?error=...&error_description=...
// instead of a session. Returns a human-readable message, or null when the
// URL carries no OAuth error.
export function parseOAuthCallbackError(search: string): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get("error_description") || params.get("error");
  if (!raw) return null;
  return decodeURIComponent(raw.replace(/\+/g, " "));
}
