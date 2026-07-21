import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Copy,
  Eye,
  EyeOff,
  FileCode2,
  FileJson,
  GripVertical,
  Globe,
  LayoutTemplate,
  Link2,
  Maximize2,
  Minimize2,
  Monitor,
  Palette,
  Plus,
  Redo2,
  Save,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  createSection,
  parseLandingDocument,
  SECTION_LABELS,
  SECTION_TYPES,
  serializeLandingV3,
  type LandingPageV3,
  type LandingSection,
  type LandingTemplateId,
  type LandingThemeId,
  type LandingUiMode,
  type SectionType,
} from "@/lib/landing/schema";
import { THEME_LIST, themeToCssVars } from "@/lib/landing/themes";
import { LANDING_TEMPLATE_LIST, templateConfig } from "@/lib/landing/templates";
import { LandingSectionRenderer } from "@/components/landing/LandingSectionRenderer";
import { SectionEditor } from "@/components/landing/SectionEditor";
import { exportLandingHtml, exportLandingJson, buildLandingHtml } from "@/lib/landing/export";
import { publicLandingUrl, publishLandingPage, unpublishLandingPage } from "@/lib/landing/publish";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";

const VIEWPORT_WIDTH: Record<Viewport, string> = { desktop: "100%", tablet: "768px", mobile: "390px" };
type Viewport = "desktop" | "tablet" | "mobile";
type Mode = "edit" | "preview" | "fullscreen";
type SaveState = "idle" | "saving" | "saved" | "error";
const HISTORY_LIMIT = 50;

function withoutMetadata(doc: LandingPageV3): unknown {
  return { ...doc, metadata: undefined };
}

function extractCopy(doc: LandingPageV3): string {
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

// Whether any testimonial/stat in the document is still AI-suggested and
// unreviewed — used to warn (never block) before publishing, per the
// anti-fabrication requirement: nothing here is factual until a human has
// actually looked at it.
function hasUnreviewedClaims(doc: LandingPageV3): boolean {
  return doc.sections.some(
    (s) =>
      (s.content.testimonials ?? []).some((t) => t.source !== "user_confirmed") ||
      (s.content.stats ?? []).some((st) => st.source !== "user_confirmed"),
  );
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
  const initialDoc = useMemo(() => parseLandingDocument(text, title), [text, title]);
  const [doc, setDoc] = useState<LandingPageV3>(initialDoc);
  const [mode, setMode] = useState<Mode>("edit");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [slugDraft, setSlugDraft] = useState(doc.seo.slug);
  const [dragId, setDragId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  // Undo/redo history: plain past/future stacks of full documents. Refs (not
  // state) because pushing to them must never itself trigger a render — only
  // the resulting setDoc does. historyTick forces the toolbar's disabled
  // state to re-evaluate after a push/pop.
  const pastRef = useRef<LandingPageV3[]>([]);
  const futureRef = useRef<LandingPageV3[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    setDoc(initialDoc);
    setSaveState("idle");
    setSelectedId(null);
    pastRef.current = [];
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
  }, [initialDoc]);

  const dirty = JSON.stringify(withoutMetadata(doc)) !== JSON.stringify(withoutMetadata(initialDoc));

  async function persist(target: LandingPageV3) {
    setSaveState("saving");
    try {
      await onSave(serializeLandingV3(target));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  // Debounced autosave (Fase C/P, extended in Landing Studio): edits never
  // cost credits, and nothing is lost if the tab closes before the timer
  // fires — dirty is recomputed from the last saved `text` prop on every
  // render.
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

  // Every content-changing action goes through here instead of setDoc
  // directly, so it becomes one undo step. UI-only state (view mode,
  // viewport, dialogs) never touches this — only `doc` itself.
  const updateDoc = useCallback((updater: (d: LandingPageV3) => LandingPageV3) => {
    setDoc((d) => {
      const next = updater(d);
      if (next === d) return d;
      pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), d];
      futureRef.current = [];
      setHistoryTick((t) => t + 1);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setDoc((d) => {
      const prev = pastRef.current.at(-1);
      if (!prev) return d;
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [...futureRef.current, d];
      setHistoryTick((t) => t + 1);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    setDoc((d) => {
      const next = futureRef.current.at(-1);
      if (!next) return d;
      futureRef.current = futureRef.current.slice(0, -1);
      pastRef.current = [...pastRef.current, d];
      setHistoryTick((t) => t + 1);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isEditable = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const sortedSections = useMemo(() => [...doc.sections].sort((a, b) => a.order - b.order), [doc.sections]);
  const selected = sortedSections.find((s) => s.id === selectedId) ?? null;

  function patchDoc(patch: Partial<LandingPageV3>) {
    updateDoc((d) => ({ ...d, ...patch }));
  }
  function updateSectionContent(id: string, content: LandingSection["content"]) {
    updateDoc((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, content } : s)) }));
  }
  function toggleVisible(id: string) {
    updateDoc((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)) }));
  }
  function duplicateSection(id: string) {
    updateDoc((d) => {
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
    updateDoc((d) => ({
      ...d,
      sections: d.sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })),
    }));
    if (selectedId === id) setSelectedId(null);
    setConfirmDeleteId(null);
  }
  function moveSection(id: string, dir: -1 | 1) {
    updateDoc((d) => {
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
  function reorderSection(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    updateDoc((d) => {
      const list = [...d.sections].sort((a, b) => a.order - b.order);
      const from = list.findIndex((s) => s.id === draggedId);
      const to = list.findIndex((s) => s.id === targetId);
      if (from === -1 || to === -1) return d;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      return { ...d, sections: list.map((s, i) => ({ ...s, order: i })) };
    });
  }
  function addSection(type: SectionType) {
    updateDoc((d) => ({ ...d, sections: [...d.sections, createSection(type, d.sections.length)] }));
    setAddPickerOpen(false);
  }
  // Switching preset/template only ever patches that one field — content,
  // images, CTAs, SEO and section order are never touched, so it's free,
  // instant, and never loses edits (Fase 8/9 of Landing Studio).
  function applyTheme(themeId: LandingThemeId) {
    const preset = THEME_LIST.find((t) => t.id === themeId);
    if (preset) patchDoc({ theme: preset });
  }
  function applyTemplate(templateId: LandingTemplateId) {
    patchDoc({ templateId });
    setTemplateOpen(false);
  }
  function toggleUiMode() {
    const next: LandingUiMode = doc.uiMode === "advanced" ? "simple" : "advanced";
    // A view-mode preference, not editable content — doesn't consume an
    // undo step, so toggling back and forth never pollutes history.
    setDoc((d) => ({ ...d, uiMode: next }));
  }

  const usedTypes = new Set(doc.sections.map((s) => s.type));
  const availableTypes = SECTION_TYPES.filter((t) => !usedTypes.has(t));
  const isAdvanced = doc.uiMode === "advanced";

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
  function confirmAndPublish() {
    if (hasUnreviewedClaims(doc)) {
      const ok = window.confirm(
        "Esta landing todavía tiene testimonios o estadísticas de ejemplo sugeridos por la IA (marcados 'Ejemplo — revisar'). ¿Confirmás que ya los revisaste y son reales antes de publicar?",
      );
      if (!ok) return;
    }
    void handlePublish();
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
        onOpenTemplate={() => setTemplateOpen(true)}
        onOpenTheme={() => setThemeOpen(true)}
        onOpenSeo={() => setSeoOpen(true)}
        onOpenPublish={() => setPublishOpen(true)}
        onOpenCode={() => setCodeOpen(true)}
        onExportHtml={() => exportLandingHtml(doc)}
        onExportJson={() => exportLandingJson(doc)}
        onCopyAll={async () => {
          await navigator.clipboard.writeText(extractCopy(doc));
          toast.success("Copy completo copiado");
        }}
        onUndo={undo}
        onRedo={redo}
        canUndo={pastRef.current.length > 0}
        canRedo={futureRef.current.length > 0}
        historyTick={historyTick}
        themeName={doc.theme.name}
        templateName={templateConfig(doc.templateId).name}
        isAdvanced={isAdvanced}
        onToggleAdvanced={toggleUiMode}
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
                  dragging={dragId === s.id}
                  onSelect={() => setSelectedId(s.id)}
                  onToggleVisible={() => toggleVisible(s.id)}
                  onDuplicate={() => duplicateSection(s.id)}
                  onDelete={() => setConfirmDeleteId(s.id)}
                  onMoveUp={() => moveSection(s.id, -1)}
                  onMoveDown={() => moveSection(s.id, 1)}
                  onDragStart={() => setDragId(s.id)}
                  onDragEnd={() => setDragId(null)}
                  onDropOn={() => {
                    if (dragId) reorderSection(dragId, s.id);
                    setDragId(null);
                  }}
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
                  templateId={doc.templateId}
                  selected={s.id === selectedId}
                  onSelect={() => setSelectedId(s.id)}
                />
              ) : (
                <LandingSectionRenderer key={s.id} section={s} theme={doc.theme} templateId={doc.templateId} />
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
      <TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} doc={doc} onApply={applyTemplate} />
      <ThemeDialog open={themeOpen} onOpenChange={setThemeOpen} doc={doc} isAdvanced={isAdvanced} onApplyPreset={applyTheme} onPatch={(theme) => patchDoc({ theme })} />
      <SeoDialog open={seoOpen} onOpenChange={setSeoOpen} doc={doc} isAdvanced={isAdvanced} onPatch={(seo) => patchDoc({ seo })} />
      {isAdvanced && <CodeDialog open={codeOpen} onOpenChange={setCodeOpen} doc={doc} />}
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        doc={doc}
        slugDraft={slugDraft}
        setSlugDraft={setSlugDraft}
        publishing={publishing}
        canPublish={!!generationId}
        onPublish={confirmAndPublish}
        onUnpublish={handleUnpublish}
        onCopyLink={copyPublicLink}
      />

      <Dialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar esta sección?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Podés deshacer esta acción con el botón Deshacer o Ctrl+Z.</p>
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
  templateId,
  selected,
  onSelect,
}: {
  section: LandingSection;
  theme: LandingPageV3["theme"];
  templateId: LandingTemplateId;
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
      <LandingSectionRenderer section={display} theme={theme} templateId={templateId} />
    </div>
  );
}

function SectionRow({
  section,
  selected,
  isFirst,
  isLast,
  dragging,
  onSelect,
  onToggleVisible,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
  onDropOn,
}: {
  section: LandingSection;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  dragging: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition ${selected ? "bg-violet-500/15 text-violet-200" : "hover:bg-white/5"} ${dragging ? "opacity-40" : ""}`}
    >
      <span className="cursor-grab text-muted-foreground/50" aria-hidden="true">
        <GripVertical className="w-3 h-3" />
      </span>
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
  onOpenTemplate,
  onOpenTheme,
  onOpenSeo,
  onOpenPublish,
  onOpenCode,
  onExportHtml,
  onExportJson,
  onCopyAll,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  historyTick,
  themeName,
  templateName,
  isAdvanced,
  onToggleAdvanced,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
  saveState: SaveState;
  dirty: boolean;
  onSaveNow: () => void;
  onOpenTemplate: () => void;
  onOpenTheme: () => void;
  onOpenSeo: () => void;
  onOpenPublish: () => void;
  onOpenCode: () => void;
  onExportHtml: () => void;
  onExportJson: () => void;
  onCopyAll: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  historyTick: number;
  themeName: string;
  templateName: string;
  isAdvanced: boolean;
  onToggleAdvanced: () => void;
}) {
  void historyTick; // forces re-render so canUndo/canRedo reflect the latest ref state
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
        <div className="inline-flex rounded-lg bg-white/5 p-1 gap-0.5">
          <IconBtn label="Deshacer (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
            <Undo2 className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn label="Rehacer (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}>
            <Redo2 className="w-3.5 h-3.5" />
          </IconBtn>
        </div>
        <button
          type="button"
          onClick={onOpenTemplate}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
        >
          <LayoutTemplate className="w-3.5 h-3.5" /> {templateName}
        </button>
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
        <button
          type="button"
          onClick={onToggleAdvanced}
          title="El modo avanzado muestra JSON, HTML y configuración técnica — no hace falta para lograr una landing profesional"
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition ${isAdvanced ? "bg-violet-500/20 text-violet-200" : "bg-white/10 hover:bg-white/15"}`}
        >
          {isAdvanced ? "Modo avanzado" : "Modo simple"}
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
        {isAdvanced && (
          <button
            type="button"
            onClick={onOpenCode}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 transition"
          >
            <Code2 className="w-3.5 h-3.5" /> Código
          </button>
        )}
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
          <Globe className="w-3.5 h-3.5" /> Publicar (preview)
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

// Small CSS-only mockup — not a screenshot, but a real structural preview:
// hero composition, nav position and card grid density actually reflect the
// template's config, so the 8 options read as genuinely different layouts
// rather than a color swatch picker.
function TemplateThumbnail({ id }: { id: LandingTemplateId }) {
  const tpl = templateConfig(id);
  const preset = THEME_LIST.find((t) => t.id === tpl.defaultPresetId) ?? THEME_LIST[0];
  const heroBlocks =
    tpl.heroLayout === "centered" || tpl.heroLayout === "fullbleed" ? (
      <div className="h-6 rounded" style={{ background: preset.primary, opacity: 0.7 }} />
    ) : (
      <div className={`grid grid-cols-2 gap-1 ${tpl.heroLayout === "split-left" ? "[direction:rtl]" : ""}`}>
        <div className="h-6 rounded" style={{ background: preset.muted, opacity: 0.4 }} />
        <div className="h-6 rounded" style={{ background: preset.primary, opacity: 0.7 }} />
      </div>
    );
  return (
    <div className="rounded-md overflow-hidden border border-white/10" style={{ background: preset.background }}>
      <div className="h-2" style={{ background: preset.surface }} />
      <div className="p-2 space-y-1.5">
        {heroBlocks}
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${tpl.gridColumns},1fr)` }}>
          {Array.from({ length: tpl.gridColumns }).map((_, i) => (
            <div key={i} className="h-4 rounded-sm" style={{ background: preset.surface, border: `1px solid ${preset.muted}44` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  doc,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doc: LandingPageV3;
  onApply: (id: LandingTemplateId) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Elegí un modelo</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2 mb-2">
          Cambiar de modelo es instantáneo: no consume créditos, no llama a la IA y no pierde tu contenido ni tus imágenes.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {LANDING_TEMPLATE_LIST.map((tpl) => {
            const active = doc.templateId === tpl.id;
            return (
              <div
                key={tpl.id}
                className={`rounded-xl border p-3 transition ${active ? "border-violet-500 bg-violet-500/10" : "border-white/10 bg-white/5"}`}
              >
                <TemplateThumbnail id={tpl.id} />
                <p className="text-sm font-semibold mt-2">{tpl.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{tpl.shortDescription}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1 italic">{tpl.recommendedFor}</p>
                <button
                  type="button"
                  onClick={() => onApply(tpl.id)}
                  disabled={active}
                  className="mt-2 w-full h-8 rounded-lg text-xs font-semibold bg-gradient-brand text-white disabled:opacity-50 transition"
                >
                  {active ? "En uso" : "Usar este modelo"}
                </button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThemeDialog({
  open,
  onOpenChange,
  doc,
  isAdvanced,
  onApplyPreset,
  onPatch,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doc: LandingPageV3;
  isAdvanced: boolean;
  onApplyPreset: (id: LandingThemeId) => void;
  onPatch: (theme: LandingPageV3["theme"]) => void;
}) {
  const t = doc.theme;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preset visual</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {THEME_LIST.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.id)}
              className={`rounded-lg border p-2.5 text-left transition ${t.id === preset.id ? "border-violet-500 bg-violet-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              <div className="flex gap-1 mb-2">
                <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ background: preset.primary }} />
                <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ background: preset.secondary }} />
                <span className="w-3.5 h-3.5 rounded-full inline-block border border-white/20" style={{ background: preset.background }} />
              </div>
              <p className="text-[11px] font-semibold">{preset.name}</p>
            </button>
          ))}
        </div>

        {!isAdvanced && (
          <p className="text-xs text-muted-foreground">
            Activá el <strong>Modo avanzado</strong> en la barra superior para personalizar colores, bordes, sombras y tipografía campo por campo.
          </p>
        )}

        {isAdvanced && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Personalización avanzada</p>
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
          </>
        )}
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
  isAdvanced,
  onPatch,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doc: LandingPageV3;
  isAdvanced: boolean;
  onPatch: (seo: LandingPageV3["seo"]) => void;
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
          {!isAdvanced && (
            <p className="text-xs text-muted-foreground">
              Activá el <strong>Modo avanzado</strong> para editar Open Graph, canonical y la opción de no-indexar.
            </p>
          )}
          {isAdvanced && (
            <>
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CodeDialog({ open, onOpenChange, doc }: { open: boolean; onOpenChange: (o: boolean) => void; doc: LandingPageV3 }) {
  const [tab, setTab] = useState<"json" | "html">("json");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contenido técnico</DialogTitle>
        </DialogHeader>
        <div className="inline-flex rounded-lg bg-white/5 p-1 gap-1 mb-2 w-fit">
          <TabBtn active={tab === "json"} onClick={() => setTab("json")}>
            JSON
          </TabBtn>
          <TabBtn active={tab === "html"} onClick={() => setTab("html")}>
            HTML
          </TabBtn>
        </div>
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed rounded-xl border border-white/10 bg-black/30 p-4 overflow-auto max-h-[55vh]">
          {tab === "json" ? JSON.stringify(doc, null, 2) : buildLandingHtml(doc)}
        </pre>
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
  doc: LandingPageV3;
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
