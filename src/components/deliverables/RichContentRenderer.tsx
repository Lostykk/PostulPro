import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// The one shared markdown-rendering surface for every deliverable — never
// render `**bold**`/`### heading`/`---` as literal characters anywhere in
// the normal ("Ver") experience. Reuses react-markdown (already a
// dependency, used by tools.consultant.tsx) instead of adding a second
// markdown engine. No rehypeRaw plugin is wired in, so raw HTML in the
// source is never rendered as HTML — react-markdown treats it as literal
// text by default, which is what makes this safe against injected
// <script>/event handlers without needing a separate sanitizer pass.
export function stripGenerationArtifacts(raw: string): string {
  return raw
    .replace(/^```[a-z]*\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

export function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trim().toLowerCase();
  return !trimmed.startsWith("javascript:") && !trimmed.startsWith("data:text/html");
}

const components: Components = {
  a: ({ href, children, ...props }) =>
    isSafeHref(href) ? (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span {...props}>{children}</span>
    ),
  script: () => null,
  iframe: () => null,
};

export function RichContentRenderer({
  content,
  size = "sm",
  className = "",
}: {
  content: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const cleaned = stripGenerationArtifacts(content);
  if (!cleaned) return null;
  return (
    <div className={`${size === "lg" ? "markdown-body-lg" : "markdown-body"} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
