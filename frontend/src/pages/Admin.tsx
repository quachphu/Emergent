import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Mail } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, SectionTitle, SensitiveNotice } from "@/components/common";
import { LanePlan } from "@/components/LanePlan";
import { LaneSteps } from "@/components/LaneSteps";
import { TaskStatusBadge } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { api, patch } from "@/lib/api";
import { daysFromToday, laneMeta, longDate, relDay } from "@/lib/format";
import { useAction } from "@/lib/queries";
import { cn } from "@/lib/utils";

type AdminItem = { key: string; title: string; due: string; link?: string | null; how: string; draft?: { subject: string; body: string } | null; task_id?: string | null; status: string };

export default function Admin() {
  const meta = laneMeta("admin");
  const q = useQuery({ queryKey: ["admin-checklist"], queryFn: () => api<{ items: AdminItem[]; notice: string }>("/admin/checklist") });
  const toggle = useAction(({ id, done }: { id: string; done: boolean }) => patch(`/tasks/${id}`, { status: done ? "done" : "todo" }));
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast.success("Email copied");
    } catch {
      toast.error("Couldn't copy.");
    }
  };
  return (
    <div className="space-y-8">
      <PageHeader emoji={meta.emoji} title="Admin & money" subtitle="Mail forwarding, DMV, voter registration, employer, bank and subscriptions — dated, with drafted emails and official links." />
      <SensitiveNotice text={q.data?.notice} />
      <Card className="p-5">
        <SectionTitle>Checklist</SectionTitle>
        {!q.data ? <Skeleton className="h-64" /> : (
          <ul className="divide-y divide-border">
            {q.data.items.map((it) => {
              const done = it.status === "done";
              return (
                <li key={it.key} className="flex gap-3 py-4" data-testid="admin-item">
                  <div className="pt-0.5">{it.task_id && <Checkbox checked={done} onChange={(v) => toggle.mutate({ id: it.task_id!, done: v })} label={`Mark ${it.title} done`} />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("font-medium", done && "text-ink-2 line-through")}>{it.title}</span>
                      <TaskStatusBadge status={it.status} />
                      <span className={cn("text-[13px] tabular", !done && daysFromToday(it.due) < 0 ? "text-danger" : "text-ink-2")} title={longDate(it.due)}>{relDay(it.due)} · {longDate(it.due)}</span>
                    </div>
                    <p className="mt-1 text-[14px] text-ink-2">{it.how}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {it.link && <Button size="sm" variant="secondary" asChild><a href={it.link} target="_blank" rel="noreferrer"><ExternalLink /> Official site</a></Button>}
                      {it.draft && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => copy(`Subject: ${it.draft!.subject}\n\n${it.draft!.body}`)}><Copy /> Copy email</Button>
                          <Button size="sm" variant="ghost" asChild><a href={`mailto:?subject=${encodeURIComponent(it.draft.subject)}&body=${encodeURIComponent(it.draft.body)}`}><Mail /> Open in mail</a></Button>
                        </>
                      )}
                    </div>
                    {it.draft && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[13px] text-ink-2 hover:text-ink">Preview draft</summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded-ctl bg-surface-2 p-3 font-sans text-[13px]">{it.draft.body}</pre>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]"><LanePlan lane="admin" /><LaneSteps lane="admin" /></div>
    </div>
  );
}
