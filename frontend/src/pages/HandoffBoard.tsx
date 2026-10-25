import { useQuery } from "@tanstack/react-query";
import { HeartHandshake, MapPin } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common";
import { PublicShell } from "@/components/PublicShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, post } from "@/lib/api";
import { shortDate, timeAgo } from "@/lib/format";
import type { Need } from "@/lib/types";
import { cn } from "@/lib/utils";

const CITIES = ["Long Beach", "San Francisco"];

export default function HandoffBoard() {
  const [city, setCity] = useState("Long Beach");
  const needs = useQuery({ queryKey: ["public-needs", city], queryFn: () => api<Need[]>(`/public/needs?city=${encodeURIComponent(city)}`) });
  const [form, setForm] = useState({ arrival_name: "", contact: "", item_wanted: "", details: "", needed_by: "", neighborhood: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/public/needs", { ...form, city, needed_by: form.needed_by || null });
      toast.success("Posted! You'll get a message when someone nearby has it.");
      setForm({ arrival_name: "", contact: "", item_wanted: "", details: "", needed_by: "", neighborhood: "" });
      needs.refetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PublicShell tagline="Free stuff from people moving out, for people moving in">
      <div className="mb-8 max-w-2xl">
        <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[.1em] text-orange-text"><HeartHandshake className="size-4" /> The Handoff board</div>
        <h1 className="mt-2 text-[34px] font-bold leading-tight sm:text-[44px]">Just arrived? Tell people what you need.</h1>
        <p className="mt-3 text-[16px] text-ink-2">Neighbors moving out hand off furniture and essentials for free. Post what you need and Handoff matches you with what's nearby.</p>
      </div>
      <div className="mb-5 flex gap-2" role="group" aria-label="City">
        {CITIES.map((c) => (
          <button key={c} onClick={() => setCity(c)} aria-pressed={city === c} className={cn("h-9 rounded-full border px-4 text-[14px] font-medium", city === c ? "border-ink bg-ink text-bg" : "border-border bg-surface")}>{c}</button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          {needs.isLoading ? <Skeleton className="h-64" /> : !needs.data?.length ? <EmptyState title="No requests yet" body="Be the first to post." /> : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {needs.data.map((n) => (
                <li key={n.id}>
                  <Card className="h-full p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-display text-[16px] font-semibold">{n.item_wanted}</div>
                      <Badge tone={n.status === "matched" ? "success" : "neutral"}>{n.status === "matched" ? "Matched" : "Open"}</Badge>
                    </div>
                    {n.details && <p className="mt-1 text-[14px] text-ink-2">{n.details}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
                      <span className="font-medium text-ink">{n.arrival_name}</span>
                      <span className="flex items-center gap-1"><MapPin className="size-3" /> {n.neighborhood || n.city}</span>
                      {n.needed_by && <span>by {shortDate(n.needed_by)}</span>}
                      <span>{timeAgo((n as any).created_at)}</span>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="h-fit p-5 lg:sticky lg:top-6">
          <h2 className="font-display text-[17px] font-semibold">Post a need in {city}</h2>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <Field label="What do you need?"><Input required minLength={2} value={form.item_wanted} onChange={(e) => setForm({ ...form, item_wanted: e.target.value })} placeholder="small desk for a studio" /></Field>
            <Field label="Details"><Textarea rows={3} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Size, style, when you can pick up" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name"><Input required value={form.arrival_name} onChange={(e) => setForm({ ...form, arrival_name: e.target.value })} /></Field>
              <Field label="Needed by"><Input type="date" value={form.needed_by} onChange={(e) => setForm({ ...form, needed_by: e.target.value })} /></Field>
            </div>
            <Field label="Neighborhood (optional)"><Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} /></Field>
            <Field label="Phone or email" hint="Only shared with the person who offers you an item."><Input required value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
            <Button type="submit" className="w-full" loading={busy}>Post need</Button>
          </form>
        </Card>
      </div>
    </PublicShell>
  );
}
