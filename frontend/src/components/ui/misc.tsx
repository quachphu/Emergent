import * as Sl from "@radix-ui/react-slider";
import * as Sw from "@radix-ui/react-switch";
import * as Tt from "@radix-ui/react-tooltip";
import * as Cb from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Slider({ value, onChange, label, min = 0, max = 100, step = 1 }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number }) {
  return (
    <Sl.Root className="relative flex h-6 w-full touch-none select-none items-center" value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} aria-label={label}>
      <Sl.Track className="relative h-1.5 grow rounded-full bg-surface-2">
        <Sl.Range className="absolute h-full rounded-full bg-orange" />
      </Sl.Track>
      <Sl.Thumb className="block size-5 rounded-full border-2 border-orange bg-surface shadow-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange/25" aria-label={label} />
    </Sl.Root>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Sw.Root checked={checked} onCheckedChange={onChange} aria-label={label} className="relative h-6 w-11 shrink-0 rounded-full bg-border transition-colors data-[state=checked]:bg-orange">
      <Sw.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </Sw.Root>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Cb.Root checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-label={label}
      className="grid size-5 shrink-0 place-items-center rounded-[6px] border border-border bg-surface transition-colors data-[state=checked]:border-success data-[state=checked]:bg-success">
      <Cb.Indicator><Check className="size-3.5 text-white" strokeWidth={3} /></Cb.Indicator>
    </Cb.Root>
  );
}

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tt.Provider delayDuration={250}>
      <Tt.Root>
        <Tt.Trigger asChild>{children}</Tt.Trigger>
        <Tt.Portal>
          <Tt.Content sideOffset={6} className="z-[60] max-w-xs rounded-ctl bg-ink px-2.5 py-1.5 text-[12px] text-bg shadow-lg animate-in fade-in-0">
            {content}
          </Tt.Content>
        </Tt.Portal>
      </Tt.Root>
    </Tt.Provider>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-ctl", className)} aria-hidden />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface px-1 font-mono text-[11px] text-ink-2">{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-border", className)} />;
}
