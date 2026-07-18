import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  FileCode2,
  FileJson,
  Globe,
  Link2,
  Maximize2,
  Minimize2,
  Monitor,
  Palette,
  Plus,
  Save,
  Search,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import {
  createSection,
  emptyLandingV2,
  migrateLegacyLanding,
  parseLandingV2,
  SECTION_LABELS,
  SECTION_TYPES,
  serializeLandingV2,
  type LandingPageV2,
  type LandingSection,
  type LandingThemeId,
  type SectionType,
} from "@/lib/landing/schema";
import { parseLandingJson } from "@/lib/deliverables/parse-landing";
import { THEME_LIST, themeToCssVars } from "@/lib/landing/themes";
import { LandingSectionRenderer } from "@/components/landing/LandingSectionRenderer";
import { SectionEditor } from "@/components/landing/SectionEditor";
import { exportLandingV2Html, exportLandingV2Json } from "@/lib/landing/export";
import { publicLandingUrl, publishLandingPage, unpublishLandingPage } from "@/lib/landing/publish";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";

const VIEWPORT_WIDTH: Record<Viewport, string> = { desktop: "100%", tablet: "768px", mobile: "390px" };
type Viewport = "desktop" | "tablet" | "mobile";
type Mode = "edit" | "preview" | "fullscreen";
type SaveState = "idle" | "saving" | "saved" | "error";

function withoutMetadata(doc: LandingPageV2): unknown {
  return { ...doc, metadata: undefined };
}

function parseInitial(text: string, title: string): LandingPageV2 {
  const v2 = parseLandingV2(text);
  if (v2) return v2;
  const legacy = parseLandingJson(text);
  if (legacy) return migrateLegacyLanding(legacy, title);
  return emptyLandingV2(title);
}

function extractCopy(doc: LandingPageV2): string {
  const lines: string[] = [];
  for (const s of [...doc.sections].sort((a, b) => a.order - b.order)) {
    if (!s.visible) continue;
    const c = s.content;
    if (c.eyebrow) lines.push(c.eyebrow);
    if (c.title) lines.push(`# ${c.title}`);
    if (c.subtitle) lines.push(c.subtitle);
    if (c.body) lines.push(c.body);
    for (const it of c.items ?? []) lines.push(`- ${it.title}: ${it.body}`);
    for (const f of c.faq ?? []) lines.push(`**${f.q}**\n${f.a}`);
    for (const t of c.testimonials ?? []) lines.push(`"${t.quote}" — ${t.name}`);
    if (c.ctaLabel) lines.push(`[CTA] ${c.ctaLabel}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function LandingBuilder({
  text,
  title,
  generationId,
  onSave,
}: {
  text: string;
  title: string;
  generationId?: string;
  onSave: (newText: string) => Promise<void> | void;
}) {
  const { user } = useAuth();
  const initialDoc = useMemo(() => parseInitial(text, title), [text, title]);
  const [doc, setDoc] = useState<LandingPageV2>(initialDoc);
  const [mode, setMode] = useState<Mode>("edit");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [slugDraft, setSlugDraft] = useState(doc.seo.slug);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    setDoc(initialDoc);
    setSaveState("idle");
    setSelectedId(null);
  }, [initialDoc]);

  const dirty = JSON.stringify(withoutMetadata(doc)) !== JSON.stringify(withoutMetadata(initialDoc));

  async function persist(target: LandingPageV2) {
    setSaveState("saving");
    try {
      await onSave(serializeLandingV2(target));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  // Debounced autosave (Fase C/P): edits never cost credits, and nothing is
  // lost if the tab closes before the timer fires — dirty is recomputed from
  // the last saved `text` prop on every render.
  useEffect(() => {
    if (!dirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist(docRef.current);
    }, 1400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const sortedSections = useMemo(() => [...doc.sections].sort((a, b) => a.order - b.order), [doc.sections]);
  const selected = sortedSections.find((s) => s.id === selectedId) ?? null;

  function patchDoc(patch: Partial<LandingPageV2>) {
    setDoc((d) => ({ ...d, ...patch }));
  }
  function updateSectionContent(id: string, content: LandingSection["content"]) {
    setDoc((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, content } : s)) }));
  }
  function toggleVisible(id: string) {
    setDoc((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)) }));
  }
  function duplicateSection(id: string) {
    setDoc((d) => {
      const sorted = [...d.sections].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === id);
      if (idx === -1) return d;
      const copy: LandingSection = {
        ...sorted[idx],
        id: `${sorted[idx].type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      };
      const next = [...sorted.slice(0, idx + 1), copy, ...sorted.slice(idx + 1)];
      return { ...d, sections: next.map((s, i) => ({ ...s, order: i })) };
    });
  }
  function removeSection(id: string) {
    setDoc((d) => ({
      ...d,
      sections: d.sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })),
    }));
    if (selectedId === id) setSelectedId(null);
    setConfirmDeleteId(null);
  }
  function moveSection(id: string, dir: -1 | 1) {
    setDoc((d) => {
      const list = [...d.sections].sort((a, b) => a.order - b.order);
      const idx = list.findIndex((s) => s.id === id);
      const swapIdx = idx + dir;
      if (idx === -1 || swapIdx < 0 || swapIdx >= list.length) return d;
      const tmp = list[idx];
      list[idx] = list[swapIdx];
      list[swapIdx] = tmp;
      return { ...d, sections: list.map((s, i) => ({ ...s, order: i })) };
    });
  }
  function addSection(type: SectionType) {
    setDoc((d) => ({ ...d, sections: [...d.sections, createSection(type, d.sections.length)] }));
    setAddPickerOpen(false);
  }
  function applyTheme(themeId: LandingThemeId) {
    const preset = THEME_LIST.find((t) => t.id === themeId);
    if (preset) patchDoc({ theme: preset });
  }

  const usedTypes = new Set(doc.sections.map((s) => s.type));
  const availableTypes = SECTION_TYPES.filter((t) => !usedTypes.has(t));

  async function handlePublish() {
    if (!generationId) return;
    setPublishing(true);
    try {
      const res = await publishLandingPage(generationId, slugDraft, doc);
      setDoc((d) => ({ ...d, publish_config: { status: "published", slug: res.slug, publishedAt: res.publishedAt } }));
      toast.success("Landing publicada en preview");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }
  async function handleUnpublish() {
    if (!generationId) return;
    try {
      await unpublishLandingPage(generationId);
      setDoc((d) => ({ ...d, publish_config: { ...d.publish_config, status: "draft" } }));
      toast.success("Landing despublicada");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function copyPublicLink() {
    if (!doc.publish_config.slug) return;
    await navigator.clipboard.writeText(publicLandingUrl(doc.publish_config.slug));
    toast.success("Link copiado");
  }

  if (doc.sections.length === 0 && mode === "edit") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-dashed border-white/20 bg-white/5 p-8 text-center text-sm text-muted-foreground">
          Esta landing todavía no tiene secciones.
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setAddPickerOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold bg-gradient-brand text-white"
            >
              <Plus className="w-3.5 h-3.5" /> Agregar sección
            </button>
          </div>
        </div>
        <AddSectionDialog open={addPickerOpen} onOpenChange={setAddPickerOpen} available={availableTypes} onAdd={addSection} />
      </div>
    );
  }

  const cssVars = themeToCssVars(doc.theme) as React.CSSProperties;

  return (
    <div className={mode === "fullscreen" ? "fixed inset-0 z-50 bg-background flex flex-col" : "space-y-3"}>
      <Toolbar
        mode={mode}
        setMode={setMode}
        viewport={viewport}
        setViewport={setViewport}
        saveState={saveState}
        dirty={dirty}
        onSaveNow={() => persist(doc)}
        onOpenTheme={() => setThemeOpen(true)}
        onOpenSeo={() => setSeoOpen(true)}
        onOpenPublish={() => setPublishOpen(true)}
        onExportHtml={() => exportLandingV2Html(doc)}
        onExportJson={() => exportLandingV2Json(doc)}
        onCopyAll={async () => {
          await navigator.clipboard.writeText(extractCopy(doc));
          toast.success("Copy completo copiado");
        }}
        themeName={doc.theme.name}
      />

      <div className={`flex gap-4 ${mode === "fullscreen" ? "flex-1 min-h-0 px-4 pb-4" : ""}`}>
        {mode === "edit" && (
          <aside className="w-[300px] shrink-0 space-y-3 overflow-y-auto max-h-[70vh]">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2 space-y-1">
              {sortedSections.map((s, i) => (
                <SectionRow
                  key={s.id}
                  section={s}
                  selected={s.id === selectedId}
                  isFirst={i === 0}
                  isLast={i === sortedSections.length - 1}
                  onSelect={() => setSelectedId(s.id)}
                  onToggleVisible={() => toggleVisible(s.id)}
                  onDuplicate={() => duplicateSection(s.id)}
                  onDelete={() => setConfirmDeleteId(s.id)}
                  onMoveUp={() => moveSection(s.id, -1)}
                  onMoveDown={() => moveSection(s.id, 1)}
                />
              ))}
              <button
                type="button"
                onClick={() => setAddPickerOpen(true)}
                className="w-full mt-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
              >
                <Plus className="w-3.5 h-3.5" /> Agregar sección
              </button>
            </div>

            {selected && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Editando: {SECTION_LABELS[selected.type]}
                </p>
                <SectionEditor
                  section={selected}
                  onChange={(content) => updateSectionContent(selected.id, content)}
                  userId={user?.id}
                />
              </div>
            )}
          </aside>
        )}

        <div className="flex-1 min-w-0 overflow-y-auto max-h-[75vh] rounded-2xl border border-white/10" style={{ background: doc.theme.background, color: doc.theme.text }}>
          <div className="mx-auto transition-[max-width] duration-200" style={{ maxWidth: VIEWPORT_WIDTH[viewport], ...cssVars }}>
            {sortedSections.map((s) =>
              mode === "edit" ? (
                <EditablePreviewSection
                  key={s.id}
                  section={s}
                  theme={doc.theme}
                  selected={s.id === selectedId}
                  onSelect={() => setSelectedId(s.id)}
                />
              ) : (
                <LandingSectionRenderer key={s.id} section={s} theme={doc.theme} />
              ),
            )}
            {sortedSections.length === 0 && (
              <div className="p-10 text-center text-sm" style={{ color: "var(--lp-muted)" }}>
                Sin secciones visibles.
              </div>
            )}
          </div>
        </div>
      </div>

      <AddSectionDialog open={addPickerOpen} onOpenChange={setAddPickerOpen} available={availableTypes} onAdd={addSection} />
      <ThemeDialog open={themeOpen} onOpenChange={setThemeOpen} doc={doc} onApplyPreset={applyTheme} onPatch={(theme) => patchDoc({ theme })} />
      <SeoDialog open={seoOpen} onOpenChange={setSeoOpen} doc={doc} onPatch={(seo) => patchDoc({ seo })} />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        doc={doc}
        slugDraft={slugDraft}
        setSlugDraft={setSlugDraft}
        publishing={publishing}
        canPublish={!!generationId}
        onPublish={handlePublish}
        onUnpublish={handleUnpublish}
        onCopyLink={copyPublicLink}
      />

      <Dialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar esta sección?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esta acción no se puede deshacer una vez guardada.</p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmDeleteId(null)}
              className="h-9 px-4 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => confirmDeleteId && removeSection(confirmDeleteId)}
              className="h-9 px-4 rounded-lg text-xs font-semibold bg-red-500/90 hover:bg-red-500 text-white transition"
            >
              Eliminar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditablePreviewSection({
  section,
  theme,
  selected,
  onSelect,
}: {
  section: LandingSection;
  theme: LandingPageV2["theme"];
  selected: boolean;
  onSelect: () => void;
}) {
  const display = section.visible ? section : { ...section, visible: true };
  return (
    <div
      onClick={onSelect}
      className={`relative cursor-pointer transition ${selected ? "ring-2 ring-violet-500 ring-inset" : "hover:ring-1 hover:ring-white/20 hover:ring-inset"} ${!section.visible ? "opacity-40" : ""}`}
    >
      {!section.visible && (
        <span className="absolute top-1 left-1 z-10 text-[10px] font-semibold uppercase tracking-wide bg-black/60 text-white px-2 py-0.5 rounded">
          Oculta
        </span>
      )}
      <LandingSectionRenderer section={display} theme={theme} />
    </div>
  );
}

function SectionRow({
  section,
  selected,
  isFirst,
  isLast,
  onSelect,
  onToggleVisible,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  section: LandingSection;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition ${selected ? "bg-violet-500/15 text-violet-200" : "hover:bg-white/5"}`}
    >
      <button type="button" onClick={onSelect} className="flex-1 text-left truncate font-medium">
        {SECTION_LABELS[section.type]}
      </button>
      <IconBtn label="Mover arriba" onClick={onMoveUp} disabled={isFirst}>
        <ArrowUp className="w-3 h-3" />
      </IconBtn>
      <IconBtn label="Mover abajo" onClick={onMoveDown} disabled={isLast}>
        <ArrowDown className="w-3 h-3" />
      </IconBtn>
      <IconBtn label={section.visible ? "Ocultar" : "Mostrar"} onClick={onToggleVisible}>
        {section.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      </IconBtn>
      <IconBtn label="Duplicar" onClick={onDuplicate}>
        <Copy className="w-3 h-3" />
      </IconBtn>
      <IconBtn label="Eliminar" onClick={onDelete}>
        <Trash2 className="w-3 h-3" />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition"
    >
      {children}
    </button>
  );
}

function Toolbar({
  mode,
  setMode,
  viewport,
  setViewport,
  saveState,
  dirty,
  onSaveNow,
  onOpenTheme,
  onOpenSeo,
  onOpenPublish,
  onExportHtml,
  onExportJson,
  onCopyAll,
  themeName,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
  saveState: SaveState;
  dirty: boolean;
  onSaveNow: () => void;
  onOpenTheme: () => void;
  onOpenSeo: () => void;
  onOpenPublish: () => void;
  onExportHtml: () => void;
  onExportJson: () => void;
  onCopyAll: () => void;
  themeName: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg bg-white/5 p-1 gap-1">
          <TabBtn active={mode === "edit"} onClick={() => setMode("edit")}>
            Editar
          </TabBtn>
          <TabBtn active={mode === "preview"} onClick={() => setMode("preview")}>
            Preview
          </TabBtn>
          <TabBtn active={mode === "fullscreen"} onClick={() => setMode("fullscreen")}>
            Pantalla completa
          </TabBtn>
        </div>
        <div className="inline-flex rounded-lg bg-white/5 p-1 gap-1">
          <IconTab label="Escritorio" active={viewport === "desktop"} onClick={() => setViewport("desktop")}>
            <Monitor className="w-3.5 h-3.5" />
          </IconTab>
          <IconTab label="Tablet" active={viewport === "tablet"} onClick={() => setViewport("tablet")}>
            <Tablet className="w-3.5 h-3.5" />
          </IconTab>
          <IconTab label="Móvil" active={viewport === "mobile"} onClick={() => setViewport("mobile")}>
            <Smartphone className="w-3.5 h-3.5" />
          </IconTab>
        </div>
        <button
          type="button"
          onClick={onOpenTheme}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
        >
          <Palette className="w-3.5 h-3.5" /> {themeName}
        </button>
        <button
          type="button"
          onClick={onOpenSeo}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
        >
          <Search className="w-3.5 h-3.5" /> SEO
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onCopyAll}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
        >
          <Copy className="w-3.5 h-3.5" /> Copiar copy
        </button>
        <button
          type="button"
          onClick={onExportHtml}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
        >
          <FileCode2 className="w-3.5 h-3.5" /> HTML
        </button>
        <button
          type="button"
          onClick={onExportJson}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
        >
          <FileJson className="w-3.5 h-3.5" /> JSON
        </button>
        <button
          type="button"
          onClick={onOpenPublish}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
        >
          <Globe className="w-3.5 h-3.5" /> Publicar
        </button>
        <SaveStatusLabel state={saveState} dirty={dirty} />
        <button
          type="button"
          onClick={onSaveNow}
          disabled={!dirty || saveState === "saving"}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-gradient-brand text-white disabled:opacity-40 transition"
        >
          <Save className="w-3.5 h-3.5" /> Guardar
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "fullscreen" ? "edit" : "fullscreen")}
          aria-label={mode === "fullscreen" ? "Salir de pantalla completa" : "Pantalla completa"}
          className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
        >
          {mode === "fullscreen" ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function IconTab({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`p-1.5 rounded-md transition ${active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function SaveStatusLabel({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state === "saving") return <span className="text-xs text-muted-foreground">Guardando…</span>;
  if (state === "error") return <span className="text-xs text-red-400">Error al guardar</span>;
  if (state === "saved" && !dirty) return <span className="text-xs text-emerald-400">Guardado</span>;
  if (dirty) return <span className="text-xs text-amber-300">Cambios sin guardar</span>;
  return <span className="text-xs text-muted-foreground">Sin cambios</span>;
}

function AddSectionDialog({
  open,
  onOpenChange,
  available,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  available: SectionType[];
  onAdd: (type: SectionType) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar sección</DialogTitle>
        </DialogHeader>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ya agregaste todos los tipos de sección disponibles.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
            {available.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onAdd(type)}
                className="text-left p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition text-sm font-medium"
              >
                {SECTION_LABELS[type]}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ThemeDialog({
  open,
  onOpenChange,
  doc,
  onApplyPreset,
  onPatch,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doc: LandingPageV2;
  onApplyPreset: (id: LandingThemeId) => void;
  onPatch: (theme: LandingPageV2["theme"]) => void;
}) {
  const t = doc.theme;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tema visual</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {THEME_LIST.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.id)}
              className={`rounded-lg border p-3 text-left transition ${t.id === preset.id ? "border-violet-500 bg-violet-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              <div className="flex gap-1 mb-2">
                <span className="w-4 h-4 rounded-full inline-block" style={{ background: preset.primary }} />
                <span className="w-4 h-4 rounded-full inline-block" style={{ background: preset.secondary }} />
                <span className="w-4 h-4 rounded-full inline-block border border-white/20" style={{ background: preset.background }} />
              </div>
              <p className="text-xs font-semibold">{preset.name}</p>
            </button>
          ))}
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Personalizar</p>
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Primario" value={t.primary} onChange={(v) => onPatch({ ...t, primary: v })} />
          <ColorField label="Secundario" value={t.secondary} onChange={(v) => onPatch({ ...t, secondary: v })} />
          <ColorField label="Fondo" value={t.background} onChange={(v) => onPatch({ ...t, background: v })} />
          <ColorField label="Texto" value={t.text} onChange={(v) => onPatch({ ...t, text: v })} />
          <div>
            <FieldLabel>Estilo de botón</FieldLabel>
            <SimpleSelect
              value={t.buttonStyle}
              onValueChange={(v) => onPatch({ ...t, buttonStyle: v as typeof t.buttonStyle })}
              options={[
                { value: "solid", label: "Sólido" },
                { value: "outline", label: "Contorno" },
                { value: "gradient", label: "Degradado" },
              ]}
            />
          </div>
          <div>
            <FieldLabel>Bordes</FieldLabel>
            <SimpleSelect
              value={t.radius}
              onValueChange={(v) => onPatch({ ...t, radius: v as typeof t.radius })}
              options={[
                { value: "none", label: "Rectos" },
                { value: "md", label: "Suaves" },
                { value: "lg", label: "Redondeados" },
                { value: "full", label: "Muy redondeados" },
              ]}
            />
          </div>
          <div>
            <FieldLabel>Espaciado</FieldLabel>
            <SimpleSelect
              value={t.spacing}
              onValueChange={(v) => onPatch({ ...t, spacing: v as typeof t.spacing })}
              options={[
                { value: "compact", label: "Compacto" },
                { value: "normal", label: "Normal" },
                { value: "spacious", label: "Espacioso" },
              ]}
            />
          </div>
          <div>
            <FieldLabel>Tipografía</FieldLabel>
            <SimpleSelect
              value={t.font}
              onValueChange={(v) => onPatch({ ...t, font: v as typeof t.font })}
              options={[
                { value: "sans", label: "Sans-serif" },
                { value: "display", label: "Display" },
              ]}
            />
          </div>
          <label className="flex items-center gap-2 text-sm mt-1">
            <input type="checkbox" checked={t.shadow} onChange={(e) => onPatch({ ...t, shadow: e.target.checked })} />
            Sombra en tarjetas
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-md border border-white/10 bg-transparent cursor-pointer"
        />
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-medium text-muted-foreground mb-1">{children}</span>;
}

function SeoDialog({
  open,
  onOpenChange,
  doc,
  onPatch,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doc: LandingPageV2;
  onPatch: (seo: LandingPageV2["seo"]) => void;
}) {
  const seo = doc.seo;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>SEO y metadatos</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <FieldLabel>Título (title)</FieldLabel>
            <input className="input" value={seo.title} onChange={(e) => onPatch({ ...seo, title: e.target.value })} />
          </div>
          <div>
            <FieldLabel>Meta description</FieldLabel>
            <textarea
              className="input min-h-[70px] resize-y"
              value={seo.description}
              onChange={(e) => onPatch({ ...seo, description: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel>Slug (para /p/:slug)</FieldLabel>
            <input
              className="input"
              value={seo.slug}
              onChange={(e) => onPatch({ ...seo, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>OG title</FieldLabel>
              <input className="input" value={seo.ogTitle} onChange={(e) => onPatch({ ...seo, ogTitle: e.target.value })} />
            </div>
            <div>
              <FieldLabel>OG image (URL)</FieldLabel>
              <input className="input" value={seo.ogImage} onChange={(e) => onPatch({ ...seo, ogImage: e.target.value })} />
            </div>
          </div>
          <div>
            <FieldLabel>OG description</FieldLabel>
            <textarea
              className="input min-h-[60px] resize-y"
              value={seo.ogDescription}
              onChange={(e) => onPatch({ ...seo, ogDescription: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel>Canonical URL (opcional)</FieldLabel>
            <input className="input" value={seo.canonical} onChange={(e) => onPatch({ ...seo, canonical: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={seo.noindex} onChange={(e) => onPatch({ ...seo, noindex: e.target.checked })} />
            No indexar (recomendado mientras es preview)
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PublishDialog({
  open,
  onOpenChange,
  doc,
  slugDraft,
  setSlugDraft,
  publishing,
  canPublish,
  onPublish,
  onUnpublish,
  onCopyLink,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doc: LandingPageV2;
  slugDraft: string;
  setSlugDraft: (s: string) => void;
  publishing: boolean;
  canPublish: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onCopyLink: () => void;
}) {
  const isPublished = doc.publish_config.status === "published";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publicar en preview</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Publica una versión de solo-preview en <code>/p/:slug</code> — nunca en postulpro.com. Podés
            despublicarla en cualquier momento.
          </p>
          <div>
            <FieldLabel>Slug</FieldLabel>
            <input className="input" value={slugDraft} onChange={(e) => setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
          </div>
          {isPublished && doc.publish_config.slug && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-200">
              Publicada en <code>/p/{doc.publish_config.slug}</code>
            </div>
          )}
          {!canPublish && (
            <p className="text-xs text-amber-300">Guardá esta generación primero para poder publicarla.</p>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {isPublished && (
            <>
              <a
                href={doc.publish_config.slug ? `/p/${doc.publish_config.slug}` : "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
              >
                Ver preview
              </a>
              <button
                type="button"
                onClick={onCopyLink}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
              >
                <Link2 className="w-3.5 h-3.5" /> Copiar enlace
              </button>
              <button
                type="button"
                onClick={onUnpublish}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium text-red-300 hover:bg-red-500/10 transition"
              >
                Despublicar
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onPublish}
            disabled={!canPublish || publishing || !slugDraft.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold bg-gradient-brand text-white disabled:opacity-40 transition"
          >
            <Globe className="w-3.5 h-3.5" /> {isPublished ? "Actualizar publicación" : "Publicar en preview"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
