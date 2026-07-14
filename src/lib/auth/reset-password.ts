// Pure helper for the password-reset redirect, kept dependency-free from
// window/router so it's unit-testable without a DOM environment.

export function resetPasswordRedirectTo(origin: string): string {
  return `${origin}/auth/reset-password`;
}
