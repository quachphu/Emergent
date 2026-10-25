import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, Pause, Pencil, Play, RefreshCw, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, PageHeader, SectionTitle } from "@/components/common";
import { PulseDot } from "@/components/motion";
import { StepTimeline } from "@/components/StepTimeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { patch, post } from "@/lib/api";
import { laneMeta } from "@/lib/format";
import { useAction, useRun, useSteps } from "@/lib/queries";
import type { Lane, Run, RunAction } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_LANE: Record<string, Lane> = {
  list_item: "stuff", offer_item: "stuff", city_pickup: "stuff", donate: "stuff",
  haul_quotes: "transport", mover_quotes: "transport", notice_letter: "old_home", lease_summary: "new_home",
};
const OUTBOUND = new Set(["offer_item", "city_pickup", "haul_quotes", "mover_quotes", "list_item"]);

function ActionRow({ run, action, index }: { run: Run; action: RunAction; index: number }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(action.title);
  const [price, setPrice] = useState<string>(action.params.start_price ? String(action.params.start_price) : "");
  const save = useAction((body: any) => patch(`/runs/${run.id}/actions/${action.id}`, body));
  const lane = laneMeta(KIND_LANE[action.kind] || "stuff");
  const editable = run.status === "proposed";
  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}
      className={cn("rounded-card border bg-surface p-4 transition-opacity", action.enabled ? "border-border" : "border-dashed border-border opacity-50")}>
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 font-display text-[13px] font-bold tabular">{index + 1}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ title, params: price ? { start_price: Number(price) } : undefined }); setEditing(false); }}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Action title" />
              {action.kind === "list_item" && <Input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Start price" placeholder="Start price ($)" />}
              <div className="flex gap-2"><Button size="sm" type="submit">Save</Button><Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button></div>
            </form>
          ) : (
            <>
              <div className={cn("text-[15px] font-medium", !action.enabled && "line-through")}>{action.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                <span>{lane.emoji} {lane.label}</span>
                {OUTBOUND.has(action.kind) && <Badge tone="warning" className="h-5">Asks you first</Badge>}
              </div>
              {action.detail && <div className="mt-1 text-[13px] text-ink-2">{action.detail}</div>}
            </>
          )}
        </div>
        {editable && !editing && (
          <div className="flex shrink-0 gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Edit action" onClick={() => setEditing(true)}><Pencil /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={action.enabled ? "Remove action" : "Restore action"} onClick={() => save.mutate({ enabled: !action.enabled })}>
              {action.enabled ? <Trash2 /> : <Undo2 />}
            </Button>
          </div>
        )}
        {!editable && (
          <span className="shrink-0">
            {action.status === "running" && <Badge tone="orange"><PulseDot className="mr-1" /> Running</Badge>}
            {action.status === "done" && <Badge tone="success"><Check /> Done</Badge>}
            {action.status === "failed" && <Badge tone="danger">Failed</Badge>}
            {action.status === "planned" && action.enabled && <Badge>Queued</Badge>}
          </span>
        )}
      </div>
    </motion.li>
  );
}

export default function RunPage() {
  const [params, setParams] = useSearchParams();
  const run = useRun();
  const r = run.data;
  const runSteps = useSteps(r ? { run_id: r.id } : {});
  const allSteps = useSteps();
  const proposedOnce = useRef(false);
  const propose = useAction(() => post("/runs/propose"), { success: "Here's the plan" });
  const approve = useAction(() => post(`/runs/${r!.id}/approve`), { success: "Plan approved — watch it run" });
  const pause = useAction(() => post(`/runs/${r!.id}/${r!.status === "paused" ? "resume" : "pause"}`));

  useEffect(() => {
    if (params.get("propose") === "1" && !proposedOnce.current && !run.isLoading) {
      proposedOnce.current = true;
      if (!r || r.status === "done" || r.status === "proposed") propose.mutate();
      params.delete("propose");
      setParams(params, { replace: true });
    }
  }, [params, run.isLoading, r, propose, setParams]);

  if (run.isError) return <ErrorState error={run.error} onRetry={() => run.refetch()} />;
  const enabled = r?.actions.filter((a) => a.enabled) || [];
  const live = r && (r.status === "running" || r.status === "paused");
  const steps = r && r.status !== "proposed" ? runSteps.data || [] : [];
  const waiting = steps.filter((s) => s.state === "waiting_for_user").length;

  return (
    <div>
      <PageHeader emoji="🤖" title="Agent runs" subtitle="Handoff proposes a plan, you edit and approve it, then every step runs live with a receipt. Anything that contacts someone, books or pays waits for your OK."
        actions={<Button onClick={() => propose.mutate()} loading={propose.isPending} variant={r?.status === "proposed" ? "secondary" : "primary"} data-testid="propose"><Sparkles /> {r?.status === "proposed" ? "Re-plan" : "New plan"}</Button>} />

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="overflow-hidden">
          <div className="relative bg-hero p-5 text-white">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-orange"><Bot className="size-4" /> Handoff</div>
            <h2 className="mt-1 font-display text-[22px] font-bold">
              {!r ? "No plan yet" : r.status === "proposed" ? "Here's what I'll do:" : r.status === "done" ? "Done. Here's what I did:" : r.status === "paused" ? "Paused" : "Working on it…"}
            </h2>
            {r && <p className="mt-1 text-[14px] text-white/60">{enabled.length} action{enabled.length === 1 ? "" : "s"}{waiting ? ` · ${waiting} waiting for your OK` : ""}</p>}
            {live && (
              <div className="absolute right-5 top-5 flex items-center gap-2">
                {r!.status === "running" && <PulseDot />}
                <Button size="sm" variant="hero" onClick={() => pause.mutate()} loading={pause.isPending}>{r!.status === "paused" ? <><Play /> Resume</> : <><Pause /> Pause</>}</Button>
              </div>
            )}
          </div>
          <div className="p-5">
            {run.isLoading || propose.isPending ? (
              <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : !r ? (
              <EmptyState title="Ask Handoff for a plan" body="It looks at your items, arrivals' needs, city rules and your dates, then proposes what to do next." action={<Button onClick={() => propose.mutate()}><Sparkles /> Propose a plan</Button>} />
            ) : !r.actions.length ? (
              <EmptyState art="inbox" title="Nothing to do right now" body="Decide more items or upload your lease and Handoff will find the next moves." />
            ) : (
              <>
                <ol className="space-y-2.5" data-testid="plan-actions">
                  <AnimatePresence>{r.actions.map((a, i) => <ActionRow key={a.id} run={r} action={a} index={i} />)}</AnimatePresence>
                </ol>
                {r.status === "proposed" && (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="text-[13px] text-ink-2">Edit or remove anything. Messages, bookings and payments still ask you first.</p>
                    <Button size="lg" onClick={() => approve.mutate()} loading={approve.isPending} disabled={!enabled.length} data-testid="approve-plan"><Check /> Approve plan</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle action={r && r.status !== "proposed" ? <Button size="sm" variant="ghost" onClick={() => runSteps.refetch()}><RefreshCw /> Refresh</Button> : undefined}>Live steps</SectionTitle>
          {r && r.status !== "proposed" ? (
            <div className="-mr-2 max-h-[78vh] overflow-y-auto pr-2"><StepTimeline steps={steps} emptyTitle="Starting…" newestFirst /></div>
          ) : (
            <EmptyState art="inbox" title="Steps appear here as they run" body="Planned steps are gray, running ones pulse orange, steps that need you get an orange outline, finished ones turn green with a receipt." />
          )}
        </Card>
      </div>

      <section className="mt-8">
        <SectionTitle>All activity</SectionTitle>
        <Card className="p-5">{allSteps.isLoading ? <Skeleton className="h-40" /> : <StepTimeline steps={(allSteps.data || []).slice(-15)} newestFirst />}</Card>
      </section>
    </div>
  );
}
