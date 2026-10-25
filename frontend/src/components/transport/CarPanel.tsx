import { useQuery } from "@tanstack/react-query";
import { Camera, Copy, Ship, Tag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, patch, post, upload } from "@/lib/api";
import { money } from "@/lib/format";
import { useAction, useInvalidateAll } from "@/lib/queries";
import type { Car } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EstimateNote, SectionTitle } from "../common";

type CarData = { car: Car | null; label: string; sell_checklist: string[]; ship_checklist: string[]; listing_draft: { title: string; body: string } | null };

export default function CarPanel() {
  const q = useQuery({ queryKey: ["car"], queryFn: () => api<CarData>("/car") });
  const invalidate = useInvalidateAll();
  const [files, setFiles] = useState<File[]>([]);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Partial<Car>>({});
  const setPath = useAction((path: string) => patch("/car", { path }));
  const save = useAction(() => patch("/car", form), { success: "Updated estimate" });
  const ship = useAction(() => post("/jobs", { type: "auto_transport" }), { success: "Auto-transport request ready — approve it in Quotes" });
  const analyze = async () => {
    setBusy(true);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("hint", hint);
    try {
      await upload("/car/analyze", fd);
      invalidate();
      toast.success("Car estimated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!q.data) return <Skeleton className="h-64" />;
  const { car } = q.data;
  if (!car)
    return (
      <Card className="max-w-2xl p-6">
        <SectionTitle>Bringing a car?</SectionTitle>
        <p className="text-[14px] text-ink-2">Add a photo of the car and one of the odometer. Handoff estimates make, model, year, mileage and a value range, then helps you sell it or ship it.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-ctl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
            <Camera className="size-4" /> {files.length ? `${files.length} photo${files.length > 1 ? "s" : ""}` : "Car + odometer photos"}
            <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          </label>
          <Input className="max-w-xs" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. 2017 Honda Civic, 68,000 miles" />
          <Button onClick={analyze} loading={busy} disabled={!files.length && !hint}>Estimate</Button>
        </div>
      </Card>
    );
  const val = (k: keyof Car) => (form[k] ?? car[k]) as any;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-[22px] font-bold">{car.year} {car.make} {car.model}</div>
            <div className="text-[13px] text-ink-2">{car.mileage ? `${car.mileage.toLocaleString()} miles` : "Mileage unknown"}{car.source === "fallback" ? " · check these details" : ""}</div>
          </div>
          <div className="text-right"><div className="font-display text-[22px] font-bold tabular">{money(car.value_low)}–{money(car.value_high)}</div><EstimateNote>{q.data.label}</EstimateNote></div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Field label="Make"><Input value={val("make")} onChange={(e) => setForm({ ...form, make: e.target.value })} /></Field>
          <Field label="Model"><Input value={val("model")} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
          <Field label="Year"><Input type="number" value={val("year")} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} /></Field>
          <Field label="Mileage"><Input type="number" value={val("mileage") ?? ""} onChange={(e) => setForm({ ...form, mileage: Number(e.target.value) })} /></Field>
        </div>
        <Button className="mt-4" size="sm" variant="secondary" disabled={!Object.keys(form).length} onClick={() => save.mutate()} loading={save.isPending}>Update estimate</Button>
      </Card>
      <Card className="p-5">
        <SectionTitle>Sell it or ship it?</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {([["sell", "Sell", Tag], ["ship", "Ship", Ship]] as const).map(([p, label, Icon]) => (
            <button key={p} onClick={() => setPath.mutate(p)} aria-pressed={car.path === p}
              className={cn("flex items-center justify-center gap-2 rounded-card border p-4 font-medium", car.path === p ? "border-orange bg-orange-tint shadow-glow" : "border-border hover:bg-surface-2")}>
              <Icon className="size-5" /> {label}
            </button>
          ))}
        </div>
        {car.path === "sell" && q.data.listing_draft && (
          <div className="mt-5 space-y-3">
            <div className="rounded-ctl border border-border p-3"><div className="font-medium">{q.data.listing_draft.title}</div><p className="mt-1 text-[13.5px] text-ink-2">{q.data.listing_draft.body}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigator.clipboard.writeText(`${q.data.listing_draft!.title}\n\n${q.data.listing_draft!.body}`).then(() => toast.success("Copied"))}><Copy /> Copy listing</Button></div>
            <ol className="list-decimal space-y-1 pl-5 text-[14px]">{q.data.sell_checklist.map((s) => <li key={s}>{s}</li>)}</ol>
            <Badge tone="warning">You sign the title yourself — Handoff never signs.</Badge>
          </div>
        )}
        {car.path === "ship" && (
          <div className="mt-5 space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-[14px]">{q.data.ship_checklist.map((s) => <li key={s}>{s}</li>)}</ol>
            <Button onClick={() => ship.mutate()} loading={ship.isPending}><Ship /> Get auto-transport quotes</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
