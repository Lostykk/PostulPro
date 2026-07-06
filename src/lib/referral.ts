import { supabase } from "@/integrations/supabase/client";

const REF_KEY = "pp_ref";

// Captures ?ref=CODE from the landing page URL, stores it for attribution at
// signup, and logs a best-effort click (analytics only — failure is silent,
// it must never block the visitor).
export function captureReferral() {
  if (typeof window === "undefined") return;
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (!ref) return;
  localStorage.setItem(REF_KEY, ref);
  void supabase.from("affiliate_clicks").insert({ affiliate_code: ref });
}

export function getStoredReferral(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REF_KEY);
}
