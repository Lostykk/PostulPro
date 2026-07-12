import { supabase } from "@/integrations/supabase/client";

// Thin authenticated-fetch helper for the AI Project Builder's JSON
// endpoints (everything except step execution, which streams — see
// use-project-step-stream.ts for that one).

export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function projectsApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new ApiError("Sesión no válida", 401);

  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; code?: string };
  if (!res.ok) {
    throw new ApiError((body.error as string) ?? `Error ${res.status}`, res.status, body.code as string | undefined);
  }
  return body as T;
}

export async function getAuthToken(): Promise<string | null> {
  const { data: sess } = await supabase.auth.getSession();
  return sess.session?.access_token ?? null;
}
