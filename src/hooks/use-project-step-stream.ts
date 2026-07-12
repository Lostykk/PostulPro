import { useRef, useState } from "react";
import { toast } from "sonner";
import { getAuthToken } from "@/lib/projects/api-client";

// SSE client for project step execution (POST .../run, .../retry,
// .../run-next). Mirrors use-ai-stream.ts's parsing exactly — same
// `data: {...}\n\n` framing, same delta/done/error event shape, just
// carrying the extra project-progress fields the executor emits.

export type StepDoneEvent = {
  generationId: string;
  stepId: string;
  projectStatus: string | null;
  progressPercent: number | null;
  currentStepId: string | null;
  creditsRemaining: number | null;
};

export function useProjectStepStream() {
  const [output, setOutput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run(url: string, stepId: string): Promise<{ event: StepDoneEvent; text: string } | null> {
    setOutput("");
    setStreaming(true);
    setActiveStepId(stepId);
    let full = "";

    try {
      const token = await getAuthToken();
      if (!token) throw new Error("Sesión no válida");

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
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
      let doneEvent: StepDoneEvent | null = null;

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
            } & Partial<StepDoneEvent>;
            if (evt.type === "delta" && evt.text) {
              full += evt.text;
              setOutput((prev) => prev + evt.text);
            } else if (evt.type === "error") {
              throw new Error(evt.message ?? "Error del modelo");
            } else if (evt.type === "done") {
              doneEvent = {
                generationId: evt.generationId ?? "",
                stepId: evt.stepId ?? stepId,
                projectStatus: evt.projectStatus ?? null,
                progressPercent: evt.progressPercent ?? null,
                currentStepId: evt.currentStepId ?? null,
                creditsRemaining: evt.creditsRemaining ?? null,
              };
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      return doneEvent ? { event: doneEvent, text: full } : null;
    } catch (err) {
      if ((err as Error).name === "AbortError") return null;
      toast.error((err as Error).message);
      return null;
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function abort() {
    abortRef.current?.abort();
  }

  return { output, streaming, activeStepId, run, abort };
}
