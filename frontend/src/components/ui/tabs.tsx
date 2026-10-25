import * as T from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = (p: ComponentProps<typeof T.Content>) => <T.Content {...p} className={cn("mt-5 outline-none", p.className)} />;
export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("no-scrollbar inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[10px] bg-surface-2 p-1", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium text-ink-2 transition-all hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm [&_svg]:size-4",
        className,
      )}
      {...p}
    />
  );
}
