import { CalendarClock, ExternalLink, FileText, Image, Receipt, ScrollText, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, PageHeader, SectionTitle, SensitiveNotice } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { assetUrl, del, upload } from "@/lib/api";
import { longDate, money, relDay, daysFromToday } from "@/lib/format";
import { useAction, useDocuments, useInvalidateAll } from "@/lib/queries";
import type { Doc } from "@/lib/types";

const ICON: Record<string, any> = { lease: ScrollText, contract: FileText, photo: Image, receipt: Receipt, letter: FileText, other: FileText };
const LABEL: Record<string, string> = { lease: "Leases", contract: "Contracts", letter: "Letters", receipt: "Receipts", photo: "Photos", other: "Other" };

export default function Vault() {
  const docs = useDocuments();
  const invalidate = useInvalidateAll();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState("contract");
  const [expires, setExpires] = useState("");
  const remove = useAction((id: string) => del(`/documents/${id}`), { success: "Removed" });
  const send = async (f?: File) => {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    fd.append("type", type);
    fd.append("expires_at", expires);
    try {
      await upload("/documents", fd);
      invalidate();
      toast.success("Saved to your Vault");
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  if (docs.isError) return <ErrorState error={docs.error} onRetry={() => docs.refetch()} />;
  const list = docs.data?.documents || [];
  const groups = Object.keys(LABEL).map((k) => ({ k, docs: list.filter((d) => d.type === k) })).filter((g) => g.docs.length);
  return (
    <div className="space-y-8">
      <PageHeader emoji="🔒" title="Vault" subtitle="Every document of your move in one place, with expiry reminders."
        actions={<div className="flex flex-wrap gap-2"><Select value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-36" aria-label="Document type">{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v.replace(/s$/, "")}</option>)}</Select>
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="h-10 w-40" aria-label="Expires on" /><Button onClick={() => input.current?.click()}><Upload /> Upload</Button></div>} />
      <input ref={input} type="file" hidden accept="application/pdf,image/*,text/plain" onChange={(e) => { send(e.target.files?.[0]); e.target.value = ""; }} />
      <SensitiveNotice text={docs.data?.notice} />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {!docs.data ? <Skeleton className="h-64" /> : !groups.length ? <EmptyState art="doc" title="Your Vault is empty" body="Leases, letters, receipts and move-out photos land here automatically." /> : groups.map((g) => (
            <section key={g.k}>
              <SectionTitle>{LABEL[g.k]}</SectionTitle>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.docs.map((d: Doc) => {
                  const Icon = ICON[d.type] || FileText;
                  const soon = d.days_to_expiry !== undefined && d.days_to_expiry <= 30;
                  return (
                    <Card key={d.id} className="flex items-center gap-3 p-3">
                      {d.type === "photo" && d.file ? <img src={assetUrl(d.file)} alt="" className="size-11 rounded-ctl object-cover" /> : <span className="grid size-11 shrink-0 place-items-center rounded-ctl bg-surface-2 text-ink-2"><Icon className="size-5" /></span>}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">{d.title}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
                          {d.amount ? <span>{money(d.amount, { cents: true })}</span> : null}
                          {d.expires_at && <Badge tone={soon ? "warning" : "neutral"} className="h-5"><CalendarClock /> expires {relDay(d.expires_at)}</Badge>}
                          {d.flags?.length ? <Badge tone="orange" className="h-5">{d.flags.length} flags</Badge> : null}
                        </div>
                      </div>
                      {(d.file || d.url) && <a href={d.url || assetUrl(d.file)} target="_blank" rel="noreferrer" className="rounded-ctl p-2 text-ink-2 hover:bg-surface-2" aria-label="Open"><ExternalLink className="size-4" /></a>}
                      <button onClick={() => remove.mutate(d.id)} className="rounded-ctl p-2 text-ink-2 hover:bg-surface-2 hover:text-danger" aria-label={`Delete ${d.title}`}><Trash2 className="size-4" /></button>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <Card className="h-fit p-5">
          <SectionTitle>Reminders</SectionTitle>
          <ul className="space-y-3">
            {(docs.data?.reminders || []).map((r) => (
              <li key={r.title} className="flex gap-3">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${daysFromToday(r.date) < 7 ? "bg-orange" : "bg-border"}`} />
                <div><div className="text-[14px] font-medium">{r.title}</div><div className="text-[13px] text-ink-2">{longDate(r.date)} · {r.note}</div></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
