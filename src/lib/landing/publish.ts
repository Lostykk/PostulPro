import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isLandingV3, migrateV2ToV3, type LandingPageV2, type LandingPageV3 } from "@/lib/landing/schema";

export type PublishResult = { slug: string; publishedAt: string };

// Publishing writes to landing_publications (see the 20260722000000
// migration), a narrow snapshot table separate from the generation itself —
// never charges credits, only ever touches the preview-only publish state.
export async function publishLandingPage(
  generationId: string,
  slug: string,
  doc: LandingPageV3,
): Promise<PublishResult> {
  const { data, error } = await supabase.rpc("publish_landing_page", {
    p_generation_id: generationId,
    p_slug: slug,
    p_data: doc as unknown as Json,
  });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("No se pudo publicar la landing");
  return { slug: row.slug, publishedAt: row.published_at };
}

export async function unpublishLandingPage(generationId: string): Promise<void> {
  const { error } = await supabase.rpc("unpublish_landing_page", { p_generation_id: generationId });
  if (error) throw new Error(error.message);
}

export type PublishedLanding = { data: LandingPageV3; publishedAt: string };

// Snapshots published before Landing Studio (v2, no templateId) are upgraded
// on read via the same pure v2->v3 migration the builder uses — the public
// page always renders a v3 doc, never a raw pre-template one.
export async function getPublishedLanding(slug: string): Promise<PublishedLanding | null> {
  const { data, error } = await supabase.rpc("get_published_landing", { p_slug: slug });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  const raw = row.data as unknown;
  const doc = isLandingV3(raw) ? raw : migrateV2ToV3(raw as LandingPageV2);
  return { data: doc, publishedAt: row.published_at };
}

export function publicLandingUrl(slug: string): string {
  return `${window.location.origin}/p/${slug}`;
}
