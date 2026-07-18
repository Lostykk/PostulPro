// Shared editable-field primitives used across every deliverable view, so
// business plan / landing / email / social editors all look and behave the
// same way instead of each reinventing slightly different inputs.

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
      {children}
    </div>
  );
}

export function EditableInput({
  value,
  onChange,
  big,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  big?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      className={`input ${big ? "font-display font-bold text-base h-11" : ""}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function EditableTextarea({
  value,
  onChange,
  rows = 2,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      className="input resize-y"
      style={{ minHeight: `${rows * 1.5 + 1}rem` }}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
    />
  );
}
