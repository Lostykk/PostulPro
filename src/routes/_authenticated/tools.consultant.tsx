import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Search, Plus, Send, Loader2, FileDown, Lock, Brain } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { useAiStream } from "@/hooks/use-ai-stream";
import { exportReportPdf } from "@/lib/pdf-export";

export const Route = createFileRoute("/_authenticated/tools/consultant")({
  head: () => ({ meta: [{ title: "Consultor IA — PostulPro" }] }),
  component: ConsultantPage,
});

type Conversation = { id: string; title: string | null; updated_at: string };
type Message = { id: string; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "¿Cómo valido mi idea de negocio antes de invertir tiempo?",
  "Ayudame a definir un pricing para mi SaaS en LATAM",
  "¿Qué canal de adquisición priorizo con presupuesto limitado?",
  "Diseñá un plan de 90 días para llegar a mis primeros 100 clientes",
];

function ConsultantPage() {
  const { profile, loading: profileLoading } = useProfile();

  if (!profileLoading && profile && profile.plan === "free") {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 text-center">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-10">
          <Lock className="w-10 h-10 mx-auto mb-4 text-violet-300" />
          <h1 className="font-display text-2xl font-bold">Consultor IA es una herramienta PRO</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Actualizá tu plan para chatear con un consultor de negocios élite con memoria de conversación, streaming y export a PDF.
          </p>
          <Link
            to="/settings"
            className="mt-6 inline-flex items-center justify-center h-11 px-6 rounded-lg bg-gradient-brand text-white font-semibold text-sm hover:opacity-95 transition"
          >
            Ver planes
          </Link>
        </div>
      </div>
    );
  }

  return <ConsultantChat />;
}

function ConsultantChat() {
  const { profile } = useProfile();
  const { output, streaming, generate } = useAiStream("consultant");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, output]);

  async function loadConversations() {
    const { data } = await supabase
      .from("consultant_conversations")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false });
    setConversations(data ?? []);
  }

  async function openConversation(id: string) {
    setActiveId(id);
    const { data } = await supabase
      .from("consultant_messages")
      .select("id,role,content")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages((data as Message[] | null) ?? []);
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setDraft("");
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || streaming || !profile) return;
    setDraft("");
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", content: text }]);

    let conversationId = activeId;
    if (!conversationId) {
      const { data, error } = await supabase
        .from("consultant_conversations")
        .insert({ user_id: profile.id, title: text.slice(0, 60) })
        .select("id")
        .single();
      if (error || !data) {
        toast.error("No se pudo crear la conversación");
        return;
      }
      conversationId = data.id;
      setActiveId(conversationId);
    }

    await supabase.from("consultant_messages").insert({ conversation_id: conversationId, role: "user", content: text });

    const history = messages
      .slice(-10)
      .map((m) => `${m.role === "user" ? "Usuario" : "Consultor"}: ${m.content}`)
      .join("\n\n");
    const prompt = `${history ? `Historial reciente de la conversación:\n${history}\n\n` : ""}Nuevo mensaje del usuario: ${text}\n\nResponde en markdown, continuando la conversación de forma coherente y accionable.`;

    const result = await generate(prompt, { title: text.slice(0, 60) });
    if (result?.text) {
      setMessages((prev) => [...prev, { id: `local-${Date.now()}-a`, role: "assistant", content: result.text }]);
      await supabase.from("consultant_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: result.text,
      });
      await supabase
        .from("consultant_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);
      void loadConversations();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handleExportPdf() {
    if (messages.length === 0) return;
    const content = messages
      .map((m) => `## ${m.role === "user" ? "Tú" : "Consultor IA"}\n${m.content}`)
      .join("\n\n");
    exportReportPdf("Conversación con Consultor IA", content);
  }

  const filteredConversations = conversations.filter((c) =>
    (c.title ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
      <div className="grid lg:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-8rem)]">
        <aside className="rounded-2xl border border-white/10 bg-white/5 p-3 flex flex-col gap-3 min-h-0">
          <button
            type="button"
            onClick={newConversation}
            className="inline-flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold bg-gradient-brand text-white hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> Nueva conversación
          </button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="input pl-8 h-9 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversaciones…"
            />
          </div>
          <div className="flex-1 overflow-auto space-y-1">
            {filteredConversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openConversation(c.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs truncate transition ${
                  activeId === c.id ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                {c.title || "Sin título"}
              </button>
            ))}
            {filteredConversations.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">Sin conversaciones aún.</p>
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-white/10 bg-[color:var(--surface-1)]/60 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Brain className="w-4 h-4 text-violet-300" /> Consultor IA
            </div>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={messages.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition disabled:opacity-40"
            >
              <FileDown className="w-3.5 h-3.5" /> Exportar PDF
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full grid place-items-center text-center">
                <div className="max-w-md">
                  <div className="text-4xl mb-3">🧠</div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Preguntale lo que necesites a tu consultor de negocios élite.
                  </p>
                  <div className="grid gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDraft(s)}
                        className="text-left text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-violet-500/40 transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <ChatBubble key={m.id} role={m.role} content={m.content} />
                ))}
                {streaming && <ChatBubble role="assistant" content={output} loading />}
              </>
            )}
          </div>

          <div className="p-4 border-t border-white/5">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                className="input flex-1 resize-none min-h-[44px] max-h-40"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribí tu mensaje… (Ctrl+Enter para enviar)"
                rows={1}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={streaming || !draft.trim()}
                className="h-11 w-11 shrink-0 grid place-items-center rounded-xl bg-gradient-brand text-white disabled:opacity-40 transition"
                aria-label="Enviar"
              >
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">2 créditos por mensaje</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function ChatBubble({ role, content, loading }: { role: "user" | "assistant"; content: string; loading?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
          isUser ? "bg-gradient-brand text-white" : "bg-white/5 border border-white/10"
        }`}
      >
        {loading && !content ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="markdown-body">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
