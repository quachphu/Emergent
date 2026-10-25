import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Briefcase, Check, Loader2, MapPin, Sparkles, Truck, Package, Luggage, Ship } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/misc";
import { post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import type { GeoPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

type Geo = { found: boolean; geo?: GeoPoint; city?: string; approximate?: boolean; source?: string } | null;

const METHODS = [
  { id: "movers", label: "Movers", body: "A crew moves what you keep.", icon: Truck },
  { id: "diy_truck", label: "DIY truck", body: "Rent a truck, drive yourself.", icon: Package },
  { id: "shipping", label: "Ship boxes", body: "Ship boxes, fly or drive light.", icon: Ship },
  { id: "suitcases", label: "Suitcases", body: "Only what fits in your bags.", icon: Luggage },
] as const;

const SIZES = [
  { id: "studio", label: "Studio" },
  { id: "1br", label: "1 bedroom" },
  { id: "2br", label: "2 bedrooms" },
  { id: "3br+", label: "3+ bedrooms" },
];

function inDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function useGeocode(address: string) {
  const [state, setState] = useState<Geo>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (address.trim().length < 4) {
      setState(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setState(await post<Geo>("/geo/geocode", { address }));
      } catch {
        setState(null);
      } finally {
        setLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [address]);
  return { geo: state, loading };
}

function GeoChip({ geo, loading }: { geo: Geo; loading: boolean }) {
  if (loading) return <span className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] text-ink-2"><Loader2 className="size-3.5 animate-spin" /> Finding it on the map…</span>;
  if (!geo) return null;
  if (!geo.found) return <span className="mt-1.5 inline-flex text-[13px] text-warning">Couldn't place this on the map — you can still continue.</span>;
  return (
    <span className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] text-success">
      <MapPin className="size-3.5" /> {geo.city || "Found"}{geo.approximate ? " (approximate)" : ""}
    </span>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const { refresh, user } = useAuth();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    move_date: inDays(21),
    from_address: "",
    to_address: "",
    work_address: "",
    home_size: "1br",
    move_method: "movers" as (typeof METHODS)[number]["id"],
    priorities: { cash: 50, speed: 50, landfill: 60 },
    relocation_budget: 2500,
    notice_period_days: 30,
  });
  const from = useGeocode(form.from_address);
  const to = useGeocode(form.to_address);
  const work = useGeocode(form.work_address);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const example = () =>
    setForm((f) => ({
      ...f,
      move_date: inDays(12),
      from_address: "245 Corona Ave, Belmont Shore, Long Beach, CA",
      to_address: "1180 Valencia St, Mission District, San Francisco, CA",
      work_address: "500 Market St, Financial District, San Francisco, CA",
      home_size: "1br",
      move_method: "shipping",
      priorities: { cash: 60, speed: 55, landfill: 80 },
    }));

  const canNext = [
    form.move_date && form.from_address.trim().length > 3 && form.to_address.trim().length > 3,
    true,
    true,
  ][step];

  const submit = async () => {
    setBusy(true);
    try {
      await post("/moves", { ...form, work_address: form.work_address || null });
      await refresh();
      navigate("/welcome", { replace: true });
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  const steps = ["Where & when", "Your home", "What matters"];
  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto flex min-h-screen max-w-[640px] flex-col px-5 py-8 sm:py-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-[9px] bg-orange"><svg viewBox="0 0 24 24" className="size-[18px]"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#1F1E1B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span className="font-display text-[17px] font-bold">Handoff</span>
          </div>
          <Button variant="ghost" size="sm" onClick={example}><Sparkles /> Fill example</Button>
        </div>

        <div className="mt-10">
          <div className="text-[13px] font-semibold text-orange-text">Step {step + 1} of 3 · {steps[step]}</div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {steps.map((s, i) => <div key={s} className={cn("h-1.5 rounded-full transition-colors", i <= step ? "bg-orange" : "bg-surface-2")} />)}
          </div>
        </div>

        <div className="relative mt-8 flex-1">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
              {step === 0 && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-[32px] font-bold leading-tight">Hi {user?.name?.split(" ")[0]} — where are you headed?</h1>
                    <p className="mt-2 text-ink-2">Handoff plans everything backward from move day.</p>
                  </div>
                  <Field label="Move day" htmlFor="move_date">
                    <Input id="move_date" type="date" value={form.move_date} min={inDays(1)} onChange={(e) => set({ move_date: e.target.value })} />
                  </Field>
                  <div>
                    <Field label="Moving from" htmlFor="from"><Input id="from" placeholder="Street, neighborhood, city" value={form.from_address} onChange={(e) => set({ from_address: e.target.value })} autoComplete="street-address" /></Field>
                    <GeoChip {...from} />
                  </div>
                  <div>
                    <Field label="Moving to" htmlFor="to"><Input id="to" placeholder="Street, neighborhood, city" value={form.to_address} onChange={(e) => set({ to_address: e.target.value })} /></Field>
                    <GeoChip {...to} />
                  </div>
                </div>
              )}
              {step === 1 && (
                <div className="space-y-6">
                  <h1 className="text-[32px] font-bold leading-tight">Tell us about your place</h1>
                  <div>
                    <div className="mb-2 text-[13px] font-medium">Home size</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {SIZES.map((s) => (
                        <button key={s.id} onClick={() => set({ home_size: s.id })} aria-pressed={form.home_size === s.id}
                          className={cn("h-12 rounded-ctl border text-[14px] font-medium transition-all", form.home_size === s.id ? "border-orange bg-orange-tint text-ink shadow-glow" : "border-border bg-surface hover:bg-surface-2")}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-[13px] font-medium">How are you moving what you keep?</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {METHODS.map((m) => (
                        <button key={m.id} onClick={() => set({ move_method: m.id })} aria-pressed={form.move_method === m.id}
                          className={cn("flex items-start gap-3 rounded-card border p-4 text-left transition-all", form.move_method === m.id ? "border-orange bg-orange-tint shadow-glow" : "border-border bg-surface hover:bg-surface-2")}>
                          <m.icon className="mt-0.5 size-5 text-orange-text" />
                          <div><div className="font-medium">{m.label}</div><div className="text-[13px] text-ink-2">{m.body}</div></div>
                          {form.move_method === m.id && <Check className="ml-auto size-5 text-orange-text" />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Field label="Lease notice period (days)" htmlFor="notice" hint="Most California leases ask for 30 days.">
                    <Input id="notice" type="number" min={0} max={120} value={form.notice_period_days} onChange={(e) => set({ notice_period_days: Number(e.target.value) })} />
                  </Field>
                </div>
              )}
              {step === 2 && (
                <div className="space-y-6">
                  <h1 className="text-[32px] font-bold leading-tight">What matters most?</h1>
                  {([["cash", "Make money from what I sell", "💵"], ["speed", "Get it done fast", "⚡"], ["landfill", "Keep stuff out of the landfill", "🌱"]] as const).map(([k, label, emoji]) => (
                    <div key={k}>
                      <div className="mb-2 flex items-center justify-between text-[14px]"><span>{emoji} {label}</span><span className="tabular text-ink-2">{form.priorities[k]}</span></div>
                      <Slider label={label} value={form.priorities[k]} onChange={(v) => set({ priorities: { ...form.priorities, [k]: v } })} />
                    </div>
                  ))}
                  <div>
                    <div className="mb-2 flex items-center justify-between text-[14px]"><span>Relocation budget</span><span className="font-semibold tabular">{money(form.relocation_budget)}</span></div>
                    <Slider label="Relocation budget" min={0} max={10000} step={100} value={form.relocation_budget} onChange={(v) => set({ relocation_budget: v })} />
                  </div>
                  <div>
                    <Field label="Work address (optional)" htmlFor="work" hint="For your commute time from the new place.">
                      <div className="relative">
                        <Briefcase className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" />
                        <Input id="work" className="pl-9" placeholder="Office address" value={form.work_address} onChange={(e) => set({ work_address: e.target.value })} />
                      </div>
                    </Field>
                    <GeoChip {...work} />
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-10 flex items-center justify-between border-t border-border pt-5">
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0}><ArrowLeft /> Back</Button>
          {step < 2 ? (
            <Button size="lg" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Continue <ArrowRight /></Button>
          ) : (
            <Button size="lg" onClick={submit} loading={busy} data-testid="build-plan">Build my plan <Sparkles /></Button>
          )}
        </div>
      </div>
    </div>
  );
}
