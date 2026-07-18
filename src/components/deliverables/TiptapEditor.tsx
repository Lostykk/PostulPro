import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { useEffect } from "react";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Undo2,
  Redo2,
  Minus,
} from "lucide-react";

// The one rich-text editing surface shared by every markdown deliverable
// (business plan, generic text). Built on Tiptap + tiptap-markdown so the
// editor speaks markdown in and out directly — no custom HTML<->Markdown
// conversion to maintain, and no second rich-text engine alongside
// react-markdown (RichContentRenderer.tsx) which handles read-only display.
export function TiptapEditor({
  markdown,
  onChange,
  autoFocus = false,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  autoFocus?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: false }),
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: markdown,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: "markdown-body-lg focus:outline-none min-h-[200px]",
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.storage.markdown.getMarkdown());
    },
  });

  // Keep the editor in sync when the parent swaps to a different section
  // (or restores the generated version) without fighting the user's own
  // typing — only reset when the incoming markdown actually differs from
  // what the editor currently holds.
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown();
    if (current !== markdown) editor.commands.setContent(markdown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, editor]);

  if (!editor) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
      <div className="flex items-center gap-0.5 flex-wrap border-b border-white/10 bg-white/5 px-2 py-1.5">
        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="Negrita">
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="Cursiva">
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="Título"
        >
          <Heading2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          label="Subtítulo"
        >
          <Heading3 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="Lista con viñetas"
        >
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="Lista numerada"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          label="Cita"
        >
          <Quote className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} label="Separador">
          <Minus className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("link")}
          onClick={() => {
            const prevUrl = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("URL del enlace", prevUrl ?? "https://");
            if (url === null) return;
            if (!url.trim()) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
          }}
          label="Enlace"
        >
          <LinkIcon className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-5 bg-white/10 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} label="Deshacer">
          <Undo2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} label="Rehacer">
          <Redo2 className="w-3.5 h-3.5" />
        </ToolbarButton>
      </div>
      <div className="p-4 max-h-[420px] overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`w-7 h-7 grid place-items-center rounded-md transition ${
        active ? "bg-violet-500/20 text-violet-200" : "text-muted-foreground hover:text-foreground hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
