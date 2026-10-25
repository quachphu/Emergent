import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ children, className, title, description, wide }: { children: ReactNode; className?: string; title: string; description?: string; wide?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-border bg-surface p-6 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          wide ? "max-w-2xl" : "max-w-lg",
          className,
        )}
      >
        <D.Title className="pr-8 font-display text-lg font-semibold">{title}</D.Title>
        {description ? <D.Description className="mt-1 text-sm text-ink-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        <div className="mt-4">{children}</div>
        <D.Close className="absolute right-4 top-4 rounded-ctl p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

/** Right side panel on desktop, bottom sheet on phones. */
export function SheetContent({ children, title, className }: { children: ReactNode; title: string; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/25 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 lg:bg-black/10" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border-border bg-surface shadow-lift outline-none",
          "inset-x-0 bottom-0 max-h-[88vh] rounded-t-[20px] border-t data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom",
          "lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[460px] lg:rounded-none lg:border-l lg:border-t-0 lg:data-[state=open]:slide-in-from-right lg:data-[state=closed]:slide-out-to-right",
          className,
        )}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title} details</D.Description>
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border lg:hidden" />
        {children}
        <D.Close className="absolute right-4 top-4 z-10 rounded-ctl bg-surface/80 p-1.5 text-ink-2 backdrop-blur hover:bg-surface-2 hover:text-ink" aria-label="Close panel">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
