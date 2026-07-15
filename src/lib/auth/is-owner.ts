// Centralized owner/founder entitlement check. Reuses the existing `admin`
// role (public.user_roles / has_role, see supabase/migrations/20260704231647)
// instead of a parallel authorization system — an owner IS an admin here.
// Takes a plain { role } shape (not the full Profile type) so it works for
// both the client Profile and the lighter row shapes fetched server-side.
export function isOwner(subject: { role?: string | null } | null | undefined): boolean {
  return subject?.role === "admin";
}
