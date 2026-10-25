import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function PublicShell({ children, tagline }: { children: ReactNode; tagline?: string }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/handoff" className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-[8px] bg-orange"><svg viewBox="0 0 24 24" className="size-4"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#1F1E1B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span className="font-display font-bold">Handoff</span>
          </Link>
          {tagline && <span className="hidden text-[13px] text-ink-2 sm:block">{tagline}</span>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
