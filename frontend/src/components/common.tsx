import { AlertTriangle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DECISION_META } from "@/lib/format";
import type { Decision } from "@/lib/types";

export function PageHeader({ emoji, title, subtitle, actions, eyebrow }: { emoji?: string; title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[12px] font-semibold uppercase tracking-[.08em] text-orange-text">{eyebrow}</div>}
        <h1 className="flex items-center gap-3 text-[28px] font-bold leading-tight sm:text-[34px]">
          {emoji && <span className="text-[30px] sm:text-[36px]" aria-hidden>{emoji}</span>}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function DecisionBadge({ decision, className }: { decision?: Decision | null; className?: string }) {
  if (!decision) return <span className={cn("inline-flex h-6 items-center rounded-full bg-warning/10 px-2.5 text-[12px] font-medium text-warning", className)}>Undecided</span>;
  const m = DECISION_META[decision];
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold", m.tone, className)}>{m.label}</span>;
}

export function ErrorState({ error, onRetry, className }: { error?: Error | null; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-card border border-danger/25 bg-danger/5 px-6 py-8 text-center", className)}>
      <AlertTriangle className="size-6 text-danger" />
      <p className="mt-2 font-medium">Couldn't load this</p>
      <p className="mt-1 text-sm text-ink-2">{error?.message || "Something went wrong."}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
}

const ART: Record<string, ReactNode> = {
  boxes: (
    <svg viewBox="0 0 160 110" className="h-24 w-36" aria-hidden>
      <ellipse cx="80" cy="100" rx="62" ry="6" className="fill-surface-2" />
      <rect x="28" y="46" width="52" height="50" rx="4" className="fill-orange-tint stroke-orange" strokeWidth="2" />
      <path d="M28 60h52M54 46v14" className="stroke-orange" strokeWidth="2" />
      <rect x="76" y="30" width="58" height="66" rx="4" className="fill-surface stroke-ink-2" strokeWidth="2" />
      <path d="M76 46h58M105 30v16" className="stroke-ink-2" strokeWidth="2" />
      <circle cx="120" cy="18" r="6" className="fill-orange" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 160 110" className="h-24 w-36" aria-hidden>
      <ellipse cx="80" cy="100" rx="60" ry="6" className="fill-surface-2" />
      <path d="M30 56l18-30h64l18 30v34a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4z" className="fill-surface stroke-ink-2" strokeWidth="2" />
      <path d="M30 56h32a18 18 0 0 0 36 0h32" className="fill-none stroke-ink-2" strokeWidth="2" />
      <path d="M70 40l8 8 14-16" className="fill-none stroke-success" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 160 110" className="h-24 w-36" aria-hidden>
      <path d="M20 24l38-10 44 12 38-10v72l-38 10-44-12-38 10z" className="fill-surface stroke-ink-2" strokeWidth="2" />
      <path d="M58 14v72M102 26v72" className="stroke-border" strokeWidth="2" />
      <path d="M36 70c20-30 50 10 88-34" className="fill-none stroke-orange" strokeWidth="3" strokeDasharray="6 6" />
      <circle cx="124" cy="36" r="6" className="fill-orange" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 160 110" className="h-24 w-36" aria-hidden>
      <ellipse cx="80" cy="100" rx="50" ry="6" className="fill-surface-2" />
      <rect x="48" y="12" width="64" height="84" rx="6" className="fill-surface stroke-ink-2" strokeWidth="2" />
      <path d="M60 32h40M60 44h40M60 56h28" className="stroke-border" strokeWidth="4" strokeLinecap="round" />
      <circle cx="104" cy="78" r="14" className="fill-orange-tint stroke-orange" strokeWidth="2" />
      <path d="M98 78l4 4 8-8" className="fill-none stroke-orange" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
};

export function EmptyState({ art = "boxes", title, body, action, className }: { art?: keyof typeof ART | string; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-card border border-dashed border-border bg-surface/60 px-6 py-10 text-center", className)}>
      {ART[art] ?? ART.boxes}
      <h3 className="mt-3 font-display text-[17px] font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function EstimateNote({ className, children = "Estimate based on similar items." }: { className?: string; children?: ReactNode }) {
  return <p className={cn("text-[12px] text-ink-2", className)}>{children}</p>;
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="font-display text-[17px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function SensitiveNotice({ text }: { text?: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-ctl border border-warning/30 bg-warning/5 px-3 py-2.5 text-[13px] text-ink">
      <span aria-hidden>🔒</span>
      <span>{text || "Never type or upload SSNs, government ID numbers, bank account numbers or passwords. Handoff doesn't need them."}</span>
    </div>
  );
}
