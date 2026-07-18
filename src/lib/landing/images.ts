import { supabase } from "@/integrations/supabase/client";

// Mirrors the allowlist enforced server-side on the landing-images bucket
// (20260723000000 migration) — checked here too so a rejected upload never
// even reaches the network, and the user gets the real reason immediately.
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function validateLandingImage(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return "Formato no soportado. Usá PNG, JPG, WEBP o GIF.";
  if (file.size > MAX_BYTES) return "La imagen supera el límite de 5 MB.";
  return null;
}

// Uploads to the owner-scoped "{user_id}/{filename}" path the bucket's RLS
// policy expects, then returns the public URL to store in section content.
export async function uploadLandingImage(userId: string, file: File): Promise<string> {
  const err = validateLandingImage(file);
  if (err) throw new Error(err);
  const ext = EXT_BY_TYPE[file.type] ?? "jpg";
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${userId}/${safeName}`;
  const { error } = await supabase.storage.from("landing-images").upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from("landing-images").getPublicUrl(path).data.publicUrl;
}
