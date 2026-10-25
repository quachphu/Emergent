import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Check, MapPin, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { ErrorState, EstimateNote } from "@/components/common";
import { PublicShell } from "@/components/PublicShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, assetUrl, post } from "@/lib/api";
import { money, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type PublicListingData = {
  title: string; description: string; price: number; status: string; photos: string[]; condition: number; dims: string; name: string;
  pickup_area: string; pickup_windows: string[]; seller_first_name: string; price_schedule: { date: string; price: number }[]; value_label: string; payment_note: string;
};

export default function PublicListing() {
  const { slug = "" } = useParams();
  const q = useQuery({ queryKey: ["public-listing", slug], queryFn: () => api<PublicListingData>(`/public/listings/${slug}`), retry: false });
  const [form, setForm] = useState({ name: "", contact: "", proposed_time: "", message: "" });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = q.data;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/public/listings/${slug}/interest`, { ...form, proposed_time: form.proposed_time || d?.pickup_windows[0] });
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PublicShell tagline="Local pickup · pay the seller in person">
      {q.isError ? <ErrorState error={q.error} /> : !d ? <Skeleton className="h-[480px]" /> : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <div className="overflow-hidden rounded-[20px] border border-border bg-surface-2 shadow-card">
              {d.photos[0] && <img src={assetUrl(d.photos[0])} alt={d.name} className="aspect-[4/3] w-full object-cover" />}
            </div>
            {d.photos.length > 1 && <div className="mt-3 grid grid-cols-4 gap-2">{d.photos.slice(1).map((p) => <img key={p} src={assetUrl(p)} alt="" className="aspect-square rounded-ctl object-cover" />)}</div>}
          </div>
          <div>
            {d.status === "sold" && <Badge tone="dark" className="mb-3">Sold</Badge>}
            <h1 className="text-[30px] font-bold leading-tight">{d.title.replace(/\s+[—-]\s+\$[\d,]+$/, "")}</h1>
            <div className="mt-3 font-display text-[40px] font-bold tabular">{money(d.price)}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
              <Badge><MapPin /> {d.pickup_area}</Badge>
              <Badge>Condition {d.condition}/5</Badge>
              {d.dims && <Badge>{d.dims}</Badge>}
            </div>
            <p className="mt-5 text-[15px] leading-relaxed">{d.description}</p>
            {d.price_schedule.length > 1 && (
              <p className="mt-3 text-[13px] text-ink-2">Price drops on {d.price_schedule.slice(1).map((p) => `${shortDate(p.date)} (${money(p.price)})`).join(", ")}.</p>
            )}
            <Card className="mt-6 p-5">
              {sent ? (
                <div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-full bg-success text-white"><Check className="size-5" /></span>
                  <div><div className="font-medium">Request sent to {d.seller_first_name}</div><p className="text-[14px] text-ink-2">They'll confirm your pickup time. Payment happens in person.</p></div></div>
              ) : d.status !== "active" ? (
                <p className="text-ink-2">This item is no longer available.</p>
              ) : (
                <form onSubmit={submit} className="space-y-3">
                  <h2 className="font-display text-[17px] font-semibold">I'm interested</h2>
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium"><CalendarClock className="size-4" /> Pick a pickup window</div>
                    <div className="flex flex-wrap gap-1.5">
                      {d.pickup_windows.map((w) => (
                        <button type="button" key={w} onClick={() => setForm({ ...form, proposed_time: w })} aria-pressed={form.proposed_time === w}
                          className={cn("rounded-full border px-3 py-1.5 text-[13px]", (form.proposed_time || d.pickup_windows[0]) === w ? "border-orange bg-orange-tint" : "border-border hover:bg-surface-2")}>{w}</button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Your name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                    <Field label="Phone or email"><Input required value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
                  </div>
                  <Field label="Message (optional)"><Textarea rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
                  {error && <p className="text-[14px] text-danger">{error}</p>}
                  <Button type="submit" size="lg" className="w-full" loading={busy}>Send pickup request</Button>
                </form>
              )}
            </Card>
            <div className="mt-4 flex items-start gap-2 text-[13px] text-ink-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> {d.payment_note} Messages from the seller are sent by Handoff, an AI assistant, on their behalf.</div>
            <EstimateNote className="mt-2">{d.value_label}</EstimateNote>
          </div>
        </div>
      )}
    </PublicShell>
  );
}
