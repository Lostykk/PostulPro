import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { LandingPageV2 } from "@/lib/landing/schema";

export type PublishResult = { slug: string; publishedAt: string };

// Publishing writes to landing_publications (see the 20260722000000
// migration), a narrow snapshot table separate from the generation itself —
// never charges credits, only ever touches the preview-only publish state.
export async function publishLandingPage(
  generationId: string,
  slug: string,
  doc: LandingPageV2,
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

export type PublishedLanding = { data: LandingPageV2; publishedAt: string };

export async function getPublishedLanding(slug: string): Promise<PublishedLanding | null> {
  const { data, error } = await supabase.rpc("get_published_landing", { p_slug: slug });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  return { data: row.data as unknown as LandingPageV2, publishedAt: row.published_at };
}

export function publicLandingUrl(slug: string): string {
  return `${window.location.origin}/p/${slug}`;
}
