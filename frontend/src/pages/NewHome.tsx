import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, FileText, HelpCircle, Plug, Sparkles, Upload, Wifi, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader, SectionTitle, SensitiveNotice } from "@/components/common";
import { LanePlan } from "@/components/LanePlan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { api, assetUrl, post, upload } from "@/lib/api";
import { laneMeta, longDate, relDay } from "@/lib/format";
import { useAction, useInvalidateAll } from "@/lib/queries";
import type { Doc } from "@/lib/types";
import { cn } from "@/lib/utils";

type NewHomeData = {
  leases: Doc[];
  legal_note: string;
  sensitive_notice: string;
  application: { key: string; title: string; note: string; done: boolean }[];
  utilities: { key: string; title: string; start: string; book_by: string; lead_days: number; link?: string | null }[];
};

const SEV = { high: "border-danger/40 bg-danger/5", medium: "border-warning/40 bg-warning/5", low: "border-border bg-surface-2/50" };
const SEV_BADGE = { high: "danger", medium: "warning", low: "neutral" } as const;

function LeaseSummary({ doc, note }: { doc: Doc; note: string }) {
  const summarize = useAction(() => post(`/documents/${doc.id}/summarize`), { success: "Lease summarized" });
  const s = doc.summary;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-ctl bg-orange-tint text-orange-text"><FileText className="size-5" /></span>
          <div><div className="font-medium">{doc.title}</div><div className="text-[12px] text-ink-2">{doc.extracted_text ? `${doc.extracted_text.split(/\s+/).length} words extracted` : "No text found"}</div></div>
        </div>
        <div className="flex gap-2">
          {doc.file && <Button size="sm" variant="ghost" asChild><a href={assetUrl(doc.file)} target="_blank" rel="noreferrer"><ExternalLink /> Open PDF</a></Button>}
          <Button size="sm" variant={s ? "secondary" : "primary"} onClick={() => summarize.mutate()} loading={summarize.isPending}><Sparkles /> {s ? "Re-summarize" : "Summarize"}</Button>
        </div>
      </div>
      {!s ? (
        <div className="p-5 text-[14px] text-ink-2">Handoff reads the lease and explains it in plain language, flags fees, notice periods, renewal, deposit and unusual terms, and lists questions to ask.</div>
      ) : (
        <div className="space-y-6 p-5">
          <div className="rounded-ctl bg-surface-2 px-3 py-2 text-[12px] font-medium text-ink-2">{note}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Rent", s.rent], ["Term", s.term], ["Deposit", s.deposit], ["Notice", s.notice_period]].map(([k, v]) => (
              <div key={k} className="rounded-ctl border border-border p-3"><div className="text-[11px] text-ink-2">{k}</div><div className="font-display font-semibold">{v || "—"}</div></div>
            ))}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-[14.5px]">{s.summary.map((b: string) => <li key={b}>{b}</li>)}</ul>
          <div>
            <h3 className="mb-2 flex items-center gap-2 font-display text-[15px] font-semibold"><AlertTriangle className="size-4 text-warning" /> Flagged clauses ({doc.flags?.length || 0})</h3>
            <div className="space-y-2">
              {(doc.flags || []).map((f, i) => (
                <div key={i} className={cn("rounded-ctl border p-3", SEV[f.severity])} data-testid="lease-flag">
                  <div className="flex items-center gap-2"><Badge tone={SEV_BADGE[f.severity]}>{f.severity}</Badge><span className="text-[12px] font-medium uppercase tracking-wide text-ink-2">{f.category.replace("_", " ")}</span></div>
                  <p className="mt-1.5 text-[13.5px] italic">“{f.clause}”</p>
                  <p className="mt-1 text-[13.5px] text-ink-2">{f.explanation}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 font-display text-[15px] font-semibold"><HelpCircle className="size-4 text-orange-text" /> Questions to ask</h3>
            <ol className="list-decimal space-y-1 pl-5 text-[14.5px]">{s.questions.map((qq: string) => <li key={qq}>{qq}</li>)}</ol>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function NewHome() {
  const meta = laneMeta("new_home");
  const invalidate = useInvalidateAll();
  const q = useQuery({ queryKey: ["new-home"], queryFn: () => api<NewHomeData>("/new-home") });
  const sample = useAction(() => post("/documents/sample-lease"), { success: "Sample lease added" });
  const check = useAction(({ key, done }: { key: string; done: boolean }) => post("/new-home/application", { key, done }));
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const send = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", f);
    form.append("type", "lease");
    try {
      await upload("/documents", form);
      invalidate();
      toast.success("Lease uploaded — summarize it below");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  return (
    <div className="space-y-8">
      <PageHeader emoji={meta.emoji} title="New home" subtitle="Your lease in plain language, the application packet, and utilities that start on move day."
        actions={<><Button variant="secondary" onClick={() => input.current?.click()} loading={busy}><Upload /> Upload lease PDF</Button><Button variant="ghost" onClick={() => sample.mutate()} loading={sample.isPending}>Use a sample lease</Button></>} />
      <input ref={input} type="file" accept="application/pdf,text/plain" hidden onChange={(e) => { send(e.target.files?.[0]); e.target.value = ""; }} />
      {!d ? <Skeleton className="h-80" /> : (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            {d.leases.length ? d.leases.map((l) => <LeaseSummary key={l.id} doc={l} note={d.legal_note} />) : <EmptyState art="doc" title="Upload your new lease" body="A PDF works best. Handoff summarizes it and flags anything worth asking about." />}
          </div>
          <div className="space-y-6">
            <Card className="p-5">
              <SectionTitle>Utilities & internet</SectionTitle>
              <div className="space-y-2">
                {d.utilities.map((u) => (
                  <div key={u.key} className="flex items-start gap-3 rounded-ctl border border-border p-3">
                    <span className="mt-0.5 text-orange-text">{u.key === "internet" ? <Wifi className="size-4" /> : u.key === "renters_insurance" ? <ShieldCheck className="size-4" /> : <Plug className="size-4" />}</span>
                    <div className="min-w-0 flex-1 text-[14px]">
                      <div className="font-medium">{u.title}</div>
                      <div className="text-[13px] text-ink-2">Start {longDate(u.start)} · book by {relDay(u.book_by)} ({u.lead_days}-day lead)</div>
                    </div>
                    {u.link && <a href={u.link} target="_blank" rel="noreferrer" className="text-[13px] text-orange-text hover:underline">Official site</a>}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-ink-2">Renters insurance: many leases require proof before you get keys.</p>
            </Card>
            <Card className="p-5">
              <SectionTitle>Application packet</SectionTitle>
              <ul className="space-y-2">
                {d.application.map((a) => (
                  <li key={a.key} className="flex items-start gap-3">
                    <Checkbox checked={a.done} onChange={(v) => check.mutate({ key: a.key, done: v })} label={a.title} />
                    <div><div className={cn("text-[14px]", a.done && "text-ink-2 line-through")}>{a.title}</div><div className="text-[12px] text-ink-2">{a.note}</div></div>
                  </li>
                ))}
              </ul>
              <div className="mt-4"><SensitiveNotice text={d.sensitive_notice} /></div>
            </Card>
          </div>
        </div>
      )}
      <LanePlan lane="new_home" />
    </div>
  );
}
