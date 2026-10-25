import { ClipboardCheck, Handshake, Layers, ListChecks, ScanLine, Tag } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ItemCard } from "@/components/cards";
import { DecisionLegend } from "@/components/cards";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { LanePlan } from "@/components/LanePlan";
import { LaneSteps } from "@/components/LaneSteps";
import { Stagger } from "@/components/motion";
import { usePanel } from "@/components/SidePanel";
import { ReviewDeck } from "@/components/stuff/ReviewDeck";
import { ScanPanel } from "@/components/stuff/ScanPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { post } from "@/lib/api";
import { DECISION_META, laneMeta, money } from "@/lib/format";
import { useAction, useItems, useRooms } from "@/lib/queries";
import type { Decision } from "@/lib/types";
import { cn } from "@/lib/utils";

const Listings = lazy(() => import("@/components/stuff/Listings"));
const HandoffMatches = lazy(() => import("@/components/stuff/HandoffMatches"));

function ItemsGrid() {
  const items = useItems();
  const rooms = useRooms();
  const panel = usePanel();
  const [filter, setFilter] = useState<Decision | "ALL" | "UNDECIDED">("ALL");
  const confirm = useAction(() => post("/inventory/confirm"), { success: "Inventory confirmed — raw scan photos are deleted in 7 days" });
  const list = useMemo(
    () => (items.data || []).filter((i) => (filter === "ALL" ? true : filter === "UNDECIDED" ? !i.decision : i.decision === filter)),
    [items.data, filter],
  );
  if (items.isError) return <ErrorState error={items.error} onRetry={() => items.refetch()} />;
  if (items.isLoading) return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="aspect-[4/5]" />)}</div>;
  if (!items.data?.length) return <EmptyState title="No items yet" body="Scan a room — Handoff turns photos into an inventory with value ranges." />;
  const total = items.data.reduce((a, i) => [a[0] + i.resale_low, a[1] + i.resale_high], [0, 0]);
  const byRoom = (rooms.data || []).map((r) => ({ room: r, items: list.filter((i) => i.room_id === r.id) })).filter((g) => g.items.length);
  const unroomed = list.filter((i) => !rooms.data?.some((r) => r.id === i.room_id));
  const counts: Record<string, number> = {};
  items.data.forEach((i) => (counts[i.decision || "UNDECIDED"] = (counts[i.decision || "UNDECIDED"] || 0) + 1));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {(["ALL", "UNDECIDED", ...Object.keys(DECISION_META)] as const).map((k) => {
            const n = k === "ALL" ? items.data!.length : counts[k] || 0;
            if (k !== "ALL" && !n) return null;
            return (
              <button key={k} onClick={() => setFilter(k as any)} aria-pressed={filter === k}
                className={cn("h-8 shrink-0 rounded-full border px-3 text-[13px] font-medium", filter === k ? "border-ink bg-ink text-bg" : "border-border bg-surface hover:bg-surface-2")}>
                {k === "ALL" ? "All" : k === "UNDECIDED" ? "Undecided" : DECISION_META[k as Decision].label} <span className="opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-[13px] text-ink-2">
          <span>Total resale estimate <b className="tabular text-ink">{money(total[0])}–{money(total[1])}</b></span>
          <Button size="sm" variant="secondary" onClick={() => confirm.mutate()} loading={confirm.isPending}><ClipboardCheck /> Confirm inventory</Button>
        </div>
      </div>
      {[...byRoom, ...(unroomed.length ? [{ room: { id: "none", name: "Other" }, items: unroomed }] : [])].map((g) => (
        <section key={g.room.id}>
          <h3 className="mb-3 font-display text-[15px] font-semibold text-ink-2">{g.room.name} <span className="font-normal">· {g.items.length}</span></h3>
          <Stagger className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.items.map((it) => <ItemCard key={it.id} item={it} onClick={() => panel.open({ type: "item", id: it.id })} />)}
          </Stagger>
        </section>
      ))}
      <DecisionLegend />
    </div>
  );
}

export default function Stuff() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "items";
  const items = useItems();
  const meta = laneMeta("stuff");
  const undecided = (items.data || []).filter((i) => !i.decision).length;
  return (
    <div>
      <PageHeader emoji={meta.emoji} title="Stuff" subtitle="Scan your home, decide what comes with you, and let Handoff sell, hand off, donate or haul the rest." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="items"><Layers /> Items</TabsTrigger>
          <TabsTrigger value="scan"><ScanLine /> Scan</TabsTrigger>
          <TabsTrigger value="review">Review{undecided ? <span className="ml-1 rounded-full bg-orange px-1.5 text-[11px] font-bold text-[#1F1E1B]">{undecided}</span> : null}</TabsTrigger>
          <TabsTrigger value="listings"><Tag /> Listings</TabsTrigger>
          <TabsTrigger value="handoff"><Handshake /> Handoff</TabsTrigger>
          <TabsTrigger value="plan"><ListChecks /> Plan</TabsTrigger>
        </TabsList>
        <TabsContent value="items"><ItemsGrid /></TabsContent>
        <TabsContent value="scan"><ScanPanel /></TabsContent>
        <TabsContent value="review">{items.isLoading ? <Skeleton className="mx-auto h-[560px] max-w-[440px]" /> : <ReviewDeck items={items.data || []} />}</TabsContent>
        <TabsContent value="listings"><Suspense fallback={<Skeleton className="h-64" />}><Listings /></Suspense></TabsContent>
        <TabsContent value="handoff"><Suspense fallback={<Skeleton className="h-64" />}><HandoffMatches /></Suspense></TabsContent>
        <TabsContent value="plan">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]"><LanePlan lane="stuff" /><LaneSteps lane="stuff" /></div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
