import { Link } from "@tanstack/react-router";
import { ArrowLeft, Sparkles } from "lucide-react";

export function ComingSoon({ title, emoji, description }: { title: string; emoji: string; description: string }) {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-16">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Volver
      </Link>
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-10 text-center">
        <div className="text-6xl mb-4">{emoji}</div>
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground max-w-lg mx-auto">{description}</p>
        <div className="mt-6 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">
          <Sparkles className="w-3.5 h-3.5" /> Próximamente en Fase 3B
        </div>
      </div>
    </div>
  );
}
