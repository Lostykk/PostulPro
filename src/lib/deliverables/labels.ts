// Honest per-block labeling for social-pack content — never call a script or
// idea a "video" or a "post publicado". Keyed by the ===TITLE=== block name
// from step-prompts.server.ts / tools.social-pack.tsx's prompt.

export const SOCIAL_CHANNEL_LABEL: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  X: "X (Twitter)",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  YOUTUBE: "YouTube",
  CALENDARIO: "Calendario semanal",
};

export const SOCIAL_FORMAT_LABEL: Record<string, string> = {
  LINKEDIN: "Copy",
  X: "Copy (hilo)",
  INSTAGRAM: "Copy",
  FACEBOOK: "Copy",
  YOUTUBE: "Guion de video",
  CALENDARIO: "Idea de calendario",
};

// A real production generation used "LinkedIn"/"YouTube" (mixed case)
// instead of the requested ALL-CAPS "LINKEDIN"/"YOUTUBE" block titles — the
// lookup is case-insensitive so labeling doesn't silently fall back to the
// generic default just because the model didn't shout the title.
export function socialChannelLabel(title: string): string {
  return SOCIAL_CHANNEL_LABEL[title.toUpperCase()] ?? title;
}

export function socialFormatLabel(title: string): string {
  return SOCIAL_FORMAT_LABEL[title.toUpperCase()] ?? "Copy";
}
