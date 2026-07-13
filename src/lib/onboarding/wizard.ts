// Pure, framework-agnostic pieces of the onboarding wizard's decision logic
// — kept out of the route component so they're unit-testable without a DOM
// environment (this repo's vitest config runs in "node", no jsdom/RTL).

export type WizardData = { goal: string | null; target: number; name: string };

export function canAdvance(step: 1 | 2 | 3, data: WizardData): boolean {
  if (step === 1) return data.goal !== null;
  if (step === 2) return data.target > 0;
  return data.name.trim().length >= 2;
}

export function stepTransitionDuration(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : 0.25;
}

export function stepLockDuration(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : 300;
}

export type CompleteOnboardingResult = { ok: true } | { ok: false; message: string };

// Orchestrates the RPC + shared-profile-cache refresh that must both
// succeed, in order, before it's safe to navigate to /dashboard. Refresh
// only runs after a successful RPC, and only once per call — the caller
// (the component's `saving` flag) is responsible for not invoking this
// again while a previous call is still in flight.
export async function runCompleteOnboarding(deps: {
  rpc: () => PromiseLike<{ error: { message: string } | null }>;
  refreshProfile: () => Promise<void>;
}): Promise<CompleteOnboardingResult> {
  const { error } = await deps.rpc();
  if (error) return { ok: false, message: error.message };
  await deps.refreshProfile();
  return { ok: true };
}

// Whether a freshly-loaded profile should redirect the user away from the
// wizard. `justCompleted` suppresses this immediately after this same
// session's own complete_onboarding call refreshed the profile — otherwise
// that same fresh profile would also satisfy this check and yank the user
// to /dashboard before they see the welcome/bonus modal.
export function shouldRedirectToDashboard(
  profile: { onboarding_completed: boolean } | null | undefined,
  justCompleted: boolean,
): boolean {
  return !justCompleted && profile?.onboarding_completed === true;
}
