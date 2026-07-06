import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";

type DoneEvent = { creditsRemaining: number | null };
type GenerateResult = { text: string; generationId: string | null } | null;

/**
 * Shared client for POST /api/generate-ai: opens the SSE stream, accumulates
 * the output, and exposes save-as-favorite for the resulting generation.
 * Used by every /tools/* page so the SSE parsing only lives in one place.
 */
export function useAiStream(tool: string) {
  const { refresh } = useProfile();
  const [output, setOutput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function generate(
    prompt: string,
    opts?: { title?: string; onDone?: (evt: DoneEvent) => void },
  ): Promise<GenerateResult> {
    setOutput("");
    setGenerationId(null);
    setSaved(false);
    setStreaming(true);
    let full = "";
    let finalGenerationId: string | null = null;

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sesión no válida");

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch("/api/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool, prompt, title: opts?.title }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Error ${res.status}`);
      }
      if (!res.body) throw new Error("Sin stream de respuesta");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!raw.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(raw.slice(5).trim()) as {
              type: string;
              text?: string;
              message?: string;
              creditsRemaining?: number;
              generationId?: string;
            };
            if (evt.type === "delta" && evt.text) {
              full += evt.text;
              setOutput((prev) => prev + evt.text);
            } else if (evt.type === "error") {
              throw new Error(evt.message ?? "Error del modelo");
            } else if (evt.type === "done") {
              if (evt.generationId) {
                finalGenerationId = evt.generationId;
                setGenerationId(evt.generationId);
              }
              const creditsRemaining =
                typeof evt.creditsRemaining === "number" ? evt.creditsRemaining : null;
              toast.success(
                creditsRemaining !== null ? `Listo · ${creditsRemaining} créditos restantes` : "Listo",
              );
              void refresh();
              opts?.onDone?.({ creditsRemaining });
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      return { text: full, generationId: finalGenerationId };
    } catch (err) {
      if ((err as Error).name === "AbortError") return null;
      toast.error((err as Error).message);
      return null;
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function save() {
    if (!generationId) return;
    const { error } = await supabase.from("generations").update({ is_favorite: true }).eq("id", generationId);
    if (error) return toast.error(error.message);
    setSaved(true);
    toast.success("Guardado en favoritos de tu biblioteca");
  }

  return { output, setOutput, streaming, generationId, saved, generate, save };
}

export function downloadTxt(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
