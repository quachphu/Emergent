import { motion } from "framer-motion";
import { Columns3, List } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { patch } from "@/lib/api";
import { longDate, relDay, TASK_STATUS_LABEL, daysFromToday } from "@/lib/format";
import { useAction, useTasks } from "@/lib/queries";
import type { Lane, Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "./common";
import { TaskRow, TaskStatusBadge } from "./cards";
import { usePanel } from "./SidePanel";

const COLUMNS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: "todo", label: "To do", dot: "bg-ink-2" },
  { status: "in_progress", label: "In progress", dot: "bg-orange" },
  { status: "waiting_for_user", label: "Waiting for you", dot: "bg-warning" },
  { status: "done", label: "Done", dot: "bg-success" },
];

function viewKey(lane: string) {
  return `handoff.view.${lane}`;
}

export function LanePlan({ lane, title = "Plan" }: { lane: Lane; title?: string }) {
  const tasks = useTasks(lane);
  const panel = usePanel();
  const [view, setView] = useState<"table" | "board">(() => {
    try {
      return (localStorage.getItem(viewKey(lane)) as "table" | "board") || "table";
    } catch {
      return "table";
    }
  });
  const setViewPersist = (v: "table" | "board") => {
    setView(v);
    try {
      localStorage.setItem(viewKey(lane), v);
    } catch {
      /* ignore */
    }
  };
  const move = useAction(({ id, status }: { id: string; status: TaskStatus }) => patch(`/tasks/${id}`, { status }));

  return (
    <section aria-label={`${title} for this lane`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-semibold">{title}</h2>
        <div className="inline-flex rounded-[10px] bg-surface-2 p-1" role="group" aria-label="View">
          {([["table", List, "Table"], ["board", Columns3, "Board"]] as const).map(([v, Icon, label]) => (
            <button key={v} onClick={() => setViewPersist(v)} aria-pressed={view === v}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium", view === v ? "bg-surface shadow-sm" : "text-ink-2 hover:text-ink")}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </div>
      {tasks.isError ? (
        <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : tasks.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !tasks.data?.length ? (
        <EmptyState title="No tasks in this lane yet" body="Handoff adds dated tasks as your plan fills in." />
      ) : view === "table" ? (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[1fr_140px_140px] gap-3 border-b border-border bg-surface-2/60 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-2 md:grid">
            <span>Task</span><span>Status</span><span>Due</span>
          </div>
          <ul>
            {tasks.data.map((t) => <TableRow key={t.id} task={t} onOpen={() => panel.open({ type: "task", id: t.id })} onToggle={(done) => move.mutate({ id: t.id, status: done ? "done" : "todo" })} />)}
          </ul>
        </Card>
      ) : (
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:px-0">
          {COLUMNS.map((col) => {
            const list = tasks.data!.filter((t) => (col.status === "done" ? t.status === "done" || t.status === "skipped" : t.status === col.status));
            return (
              <div key={col.status} className="min-w-[260px] snap-start rounded-card bg-surface-2/70 p-2.5 md:min-w-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { const id = e.dataTransfer.getData("text/task"); if (id) move.mutate({ id, status: col.status }); }}>
                <div className="mb-2 flex items-center gap-2 px-1.5 text-[13px] font-semibold">
                  <span className={cn("size-2 rounded-full", col.dot)} /> {col.label} <span className="font-normal text-ink-2">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.map((t) => (
                    <motion.button layout key={t.id} draggable onDragStart={(e: any) => e.dataTransfer.setData("text/task", t.id)} onClick={() => panel.open({ type: "task", id: t.id })}
                      className="w-full rounded-ctl border border-border bg-surface p-3 text-left shadow-sm transition-shadow hover:shadow-card">
                      <div className="text-[14px] font-medium leading-snug">{t.title}</div>
                      <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
                        <span className={cn(daysFromToday(t.due_date) < 0 && t.status !== "done" && "text-danger")}>{relDay(t.due_date)}</span>
                        {t.tight && t.status !== "done" && <Badge tone="danger" className="h-5">Tight</Badge>}
                      </div>
                    </motion.button>
                  ))}
                  {!list.length && <div className="rounded-ctl border border-dashed border-border px-3 py-5 text-center text-[12px] text-ink-2">Drop tasks here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TableRow({ task, onOpen, onToggle }: { task: Task; onOpen: () => void; onToggle: (d: boolean) => void }) {
  return (
    <li className="border-b border-border last:border-0">
      <div className="md:hidden"><div className="px-2"><TaskRow task={task} onOpen={onOpen} onToggle={onToggle} /></div></div>
      <div className="hidden grid-cols-[1fr_140px_140px] items-center gap-3 px-4 py-1 md:grid">
        <div className="-mx-2"><TaskRow task={task} bare onOpen={onOpen} onToggle={onToggle} /></div>
        <div><TaskStatusBadge status={task.status} /></div>
        <div className="text-[13px] tabular text-ink-2" title={longDate(task.due_date)}>
          {relDay(task.due_date)} {task.tight && task.status !== "done" && <Badge tone="danger" className="ml-1 h-5">Tight</Badge>}
        </div>
      </div>
    </li>
  );
}

export { TASK_STATUS_LABEL };
