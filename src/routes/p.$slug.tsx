import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getPublishedLanding } from "@/lib/landing/publish";
import type { LandingPageV2 } from "@/lib/landing/schema";
import { LandingSectionRenderer } from "@/components/landing/LandingSectionRenderer";
import { themeToCssVars } from "@/lib/landing/themes";

// Public, unauthenticated preview-only publish route (Fase L). Always
// noindex regardless of the document's own seo.noindex toggle — this is a
// preview surface, never postulpro.com, and must never be picked up by
// search engines while the feature is in this state.
export const Route = createFileRoute("/p/$slug")({
  head: () => ({
    meta: [{ title: "Preview — PostulPro" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: PublicLandingPage,
});

type State =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error" }
  | { status: "ready"; doc: LandingPageV2 };

function PublicLandingPage() {
  const { slug } = Route.useParams();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getPublishedLanding(slug)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setState({ status: "not_found" });
          return;
        }
        setState({ status: "ready", doc: res.data });
        document.title = res.data.seo.title || "Preview — PostulPro";
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === "loading") {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Cargando…</div>
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-foreground px-4">
        <div className="text-center max-w-sm">
          <p className="text-4xl mb-3">🔍</p>
          <h1 className="font-display text-xl font-bold mb-2">Esta página no existe</h1>
          <p className="text-sm text-muted-foreground">
            El link no corresponde a ninguna landing publicada, o fue despublicada por su autor.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-foreground px-4">
        <div className="text-center max-w-sm">
          <p className="text-4xl mb-3">⚠️</p>
          <h1 className="font-display text-xl font-bold mb-2">No pudimos cargar esta página</h1>
          <p className="text-sm text-muted-foreground">Probá recargar en unos segundos.</p>
        </div>
      </div>
    );
  }

  const { doc } = state;
  const cssVars = themeToCssVars(doc.theme) as React.CSSProperties;
  const sections = [...doc.sections].sort((a, b) => a.order - b.order);

  return (
    <div style={{ background: doc.theme.background, color: doc.theme.text, minHeight: "100vh", ...cssVars }}>
      {sections.map((s) => (
        <LandingSectionRenderer key={s.id} section={s} theme={doc.theme} />
      ))}
      <div className="text-center py-4 text-[11px]" style={{ color: "var(--lp-muted)" }}>
        Página de preview — creada con PostulPro
      </div>
    </div>
  );
}
