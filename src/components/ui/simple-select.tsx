import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SimpleSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

// Drop-in replacement for a native <select value onChange> pair, built on the
// existing Radix-based Select primitives. Renders its own fully-styled popup
// instead of the OS-native dropdown, which is what was making options
// unreadable on Windows (native popups there ignore our dark theme).
export function SimpleSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SimpleSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "rounded-lg border-white/10 bg-white/5 text-sm text-foreground hover:bg-white/[0.07]",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
