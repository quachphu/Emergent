import * as D from "@radix-ui/react-dialog";
import { Trash2 } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, assetUrl, del, patch } from "@/lib/api";
import { DECISION_META, laneMeta, longDate, money, range, STATUS_LABEL } from "@/lib/format";
import { useAction, useSteps, useTasks } from "@/lib/queries";
import type { Decision, Item, Step, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { DecisionBadge, EstimateNote } from "./common";
import { StepCard, StepTimeline } from "./StepTimeline";
import { TaskStatusBadge } from "./cards";

type PanelTarget = { type: "item"; id: string } | { type: "task"; id: string } | { type: "step"; step: Step } | null;

const Ctx = createContext<{ open: (t: PanelTarget) => void }>({ open: () => {} });
export const usePanel = () => useContext(Ctx);

export function PanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<PanelTarget>(null);
  return (
    <Ctx.Provider value={{ open: setTarget }}>
      {children}
      <D.Root open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        {target && (
          <SheetContent title={target.type === "item" ? "Item" : target.type === "task" ? "Task" : "Step"}>
            <div className="flex-1 overflow-y-auto">
              {target.type === "item" && <ItemPanel id={target.id} onClose={() => setTarget(null)} />}
              {target.type === "task" && <TaskPanel id={target.id} />}
              {target.type === "step" && (
                <div className="p-5 pt-10">
                  <ol className="relative"><StepCard step={target.step} /></ol>
                </div>
              )}
            </div>
          </SheetContent>
        )}
      </D.Root>
    </Ctx.Provider>
  );
}

function ItemPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["item", id], queryFn: () => api<Item & { listing: any; matches: any[]; steps: Step[] }>(`/items/${id}`) });
  const [form, setForm] = useState<Partial<Item>>({});
  useEffect(() => {
    if (q.data) setForm({ name: q.data.name, brand_guess: q.data.brand_guess, condition: q.data.condition, size: q.data.size, resale_low: q.data.resale_low, resale_high: q.data.resale_high });
  }, [q.data]);
  const save = useAction((body: Partial<Item>) => patch(`/items/${id}`, body), { success: "Saved" });
  const remove = useAction(() => del(`/items/${id}`), { success: "Item removed", onSuccess: onClose });
  if (q.isLoading || !q.data) return <div className="space-y-3 p-5 pt-10"><Skeleton className="aspect-[4/3] w-full" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>;
  const it = q.data;
  const dirty = JSON.stringify(form) !== JSON.stringify({ name: it.name, brand_guess: it.brand_guess, condition: it.condition, size: it.size, resale_low: it.resale_low, resale_high: it.resale_high });
  return (
    <div>
      <div className="relative aspect-[4/3] bg-surface-2">
        {it.photos?.[0] && <img src={assetUrl(it.photos[0])} alt={it.name} className="h-full w-full object-cover" />}
      </div>
      <div className="space-y-5 p-5">
        <div>
          <div className="flex items-center gap-2"><DecisionBadge decision={it.decision} />{STATUS_LABEL[it.status] && <Badge>{STATUS_LABEL[it.status]}</Badge>}</div>
          <h2 className="mt-2 text-[22px] font-bold">{it.name}</h2>
          <div className="mt-1 text-[13px] text-ink-2">{[it.brand_guess, it.category, it.dims_estimate].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Resale", range(it.resale_low, it.resale_high)],
            ["To move", money(it.move_cost_estimate)],
            ["To replace", money(it.replacement_cost_estimate)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-ctl bg-surface-2 p-2.5">
              <div className="text-[11px] text-ink-2">{k}</div>
              <div className="font-display font-semibold tabular">{v}</div>
            </div>
          ))}
        </div>
        <EstimateNote />
        {(it.decision_reason || it.suggestion) && (
          <div className="rounded-ctl border border-border p-3 text-[13.5px]">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-orange-text">Why</div>
            {it.decision_reason || it.suggestion?.reason}
            {!it.decision && it.suggestion && <div className="mt-1 text-ink-2">Suggested: {DECISION_META[it.suggestion.decision].label}</div>}
          </div>
        )}
        <div>
          <div className="mb-2 text-[13px] font-medium">Decision</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(DECISION_META) as Decision[]).map((d) => (
              <button key={d} onClick={() => save.mutate({ decision: d } as any)}
                className={cn("rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors", it.decision === d ? "border-orange bg-orange-tint text-orange-text" : "border-border hover:bg-surface-2")}>
                {DECISION_META[d].label}
              </button>
            ))}
          </div>
        </div>
        <details className="rounded-ctl border border-border p-3" open={it.source === "fallback"}>
          <summary className="cursor-pointer text-[13px] font-medium">Edit details</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label="Name"><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
            <Field label="Brand"><Input value={form.brand_guess ?? ""} onChange={(e) => setForm({ ...form, brand_guess: e.target.value })} /></Field>
            <Field label="Condition (1–5)"><Select value={form.condition} onChange={(e) => setForm({ ...form, condition: Number(e.target.value) })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
            <Field label="Low $"><Input type="number" value={form.resale_low ?? 0} onChange={(e) => setForm({ ...form, resale_low: Number(e.target.value) })} /></Field>
            <Field label="High $"><Input type="number" value={form.resale_high ?? 0} onChange={(e) => setForm({ ...form, resale_high: Number(e.target.value) })} /></Field>
          </div>
          <div className="mt-3 flex justify-between">
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove.mutate()} loading={remove.isPending}><Trash2 /> Delete item</Button>
            <Button size="sm" disabled={!dirty} onClick={() => save.mutate({ ...form, brand_guess: form.brand_guess || null } as any)} loading={save.isPending}>Save</Button>
          </div>
        </details>
        {it.listing && (
          <div className="rounded-ctl border border-border p-3 text-[13.5px]">
            <div className="flex items-center justify-between"><span className="font-medium">{it.listing.title}</span><Badge tone={it.listing.status === "active" ? "success" : "neutral"}>{it.listing.status}</Badge></div>
            {it.listing.status !== "draft" && <Link to={`/l/${it.listing.public_slug}`} className="mt-1 inline-block text-orange-text hover:underline">Open public page</Link>}
          </div>
        )}
        {it.matches?.length > 0 && (
          <div>
            <div className="mb-2 text-[13px] font-medium">Arrivals who need this</div>
            <div className="space-y-2">
              {it.matches.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between rounded-ctl bg-surface-2 px-3 py-2 text-[13px]">
                  <span><span className="font-medium">{m.need?.arrival_name}</span> · {m.need?.item_wanted}</span>
                  <span className="tabular text-ink-2">{Math.round(m.score * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {it.steps?.length > 0 && (
          <div>
            <div className="mb-2 text-[13px] font-medium">Agent steps</div>
            <StepTimeline steps={it.steps} showLane={false} />
          </div>
        )}
      </div>
    </div>
  );
}

function TaskPanel({ id }: { id: string }) {
  const tasks = useTasks();
  const steps = useSteps();
  const task = tasks.data?.find((t) => t.id === id) as Task | undefined;
  const update = useAction((status: string) => patch(`/tasks/${id}`, { status }), { success: "Updated" });
  if (!task) return <div className="p-5 pt-10"><Skeleton className="h-6 w-2/3" /></div>;
  const lane = laneMeta(task.lane);
  const related = (steps.data || []).filter((s) => s.task_id === id);
  return (
    <div className="space-y-5 p-5 pt-10">
      <div>
        <Link to={lane.path} className="text-[13px] text-ink-2 hover:text-ink">{lane.emoji} {lane.label}</Link>
        <h2 className="mt-1 text-[22px] font-bold">{task.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          <TaskStatusBadge status={task.status} />
          <span className="text-ink-2">Due {longDate(task.due_date)}</span>
          {task.tight && <Badge tone="danger">Tight timeline</Badge>}
        </div>
      </div>
      {task.notes && <p className="rounded-ctl bg-surface-2 p-3 text-[13.5px]">{task.notes}</p>}
      <div>
        <div className="mb-2 text-[13px] font-medium">Status</div>
        <div className="flex flex-wrap gap-1.5">
          {["todo", "in_progress", "done", "skipped"].map((s) => (
            <button key={s} onClick={() => update.mutate(s)} className={cn("rounded-full border px-3 py-1.5 text-[13px] font-medium", task.status === s ? "border-orange bg-orange-tint text-orange-text" : "border-border hover:bg-surface-2")}>
              {{ todo: "To do", in_progress: "In progress", done: "Done", skipped: "Skip" }[s]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium">Agent steps</div>
        <StepTimeline steps={related} showLane={false} emptyTitle="No steps yet" emptyBody="Approve a plan and Handoff's work on this task appears here." />
      </div>
    </div>
  );
}
