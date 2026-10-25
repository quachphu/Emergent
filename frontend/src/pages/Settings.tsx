import { CheckCircle2, CircleDashed, LogOut, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader, SectionTitle } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton, Slider } from "@/components/ui/misc";
import { patch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { useAction, useConfig, useMove } from "@/lib/queries";
import { applyTheme, getTheme, type Theme } from "@/lib/theme";
import type { Move } from "@/lib/types";
import { cn } from "@/lib/utils";

const INTEGRATIONS: Record<string, { label: string; off: string }> = {
  llm: { label: "AI model", off: "Offline rules and catalog (set ANTHROPIC_API_KEY or EMERGENT_LLM_KEY)" },
  embeddings: { label: "Matching embeddings", off: "Local similarity (Voyage unreachable or not set)" },
  stripe: { label: "Stripe payments", off: "Simulated test checkout" },
  sms: { label: "SMS (Twilio)", off: "Simulated — messages are logged, not sent" },
  maps: { label: "Maps", off: "OpenStreetMap 2D" },
};

export default function SettingsPage() {
  const { user, signOut, startDemo } = useAuth();
  const navigate = useNavigate();
  const move = useMove();
  const config = useConfig();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [form, setForm] = useState<Partial<Move>>({});
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (move.data) setForm({ move_date: move.data.move_date, from_address: move.data.from_address, to_address: move.data.to_address, work_address: move.data.work_address, move_method: move.data.move_method, relocation_budget: move.data.relocation_budget, priorities: move.data.priorities });
  }, [move.data]);
  const save = useAction(() => patch("/moves/current", form), { success: "Saved — your plan was rebuilt" });
  const reset = async () => {
    setResetting(true);
    try {
      await startDemo();
      toast.success("Demo restored", { description: "Maya's move is back to the start." });
      navigate("/");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setResetting(false);
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader emoji="⚙️" title="Settings" subtitle={`Signed in as ${user?.email}`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <SectionTitle>Your move</SectionTitle>
          {!move.data ? <Skeleton className="h-64" /> : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Move day"><Input type="date" value={form.move_date || ""} onChange={(e) => setForm({ ...form, move_date: e.target.value })} /></Field>
                <Field label="Moving method">
                  <Select value={form.move_method} onChange={(e) => setForm({ ...form, move_method: e.target.value as Move["move_method"] })}>
                    <option value="movers">Movers</option><option value="diy_truck">DIY truck</option><option value="shipping">Ship boxes</option><option value="suitcases">Suitcases</option>
                  </Select>
                </Field>
              </div>
              <Field label="Moving from"><Input value={form.from_address || ""} onChange={(e) => setForm({ ...form, from_address: e.target.value })} /></Field>
              <Field label="Moving to"><Input value={form.to_address || ""} onChange={(e) => setForm({ ...form, to_address: e.target.value })} /></Field>
              <Field label="Work address"><Input value={form.work_address || ""} onChange={(e) => setForm({ ...form, work_address: e.target.value })} /></Field>
              <div>
                <div className="mb-2 flex justify-between text-[13px]"><span className="font-medium">Relocation budget</span><span className="tabular">{money(form.relocation_budget)}</span></div>
                <Slider label="Relocation budget" min={0} max={10000} step={100} value={form.relocation_budget || 0} onChange={(v) => setForm({ ...form, relocation_budget: v })} />
              </div>
              {form.priorities && (["cash", "speed", "landfill"] as const).map((k) => (
                <div key={k}>
                  <div className="mb-2 flex justify-between text-[13px]"><span className="font-medium">{{ cash: "💵 Make money", speed: "⚡ Speed", landfill: "🌱 Keep it out of the landfill" }[k]}</span><span className="tabular">{form.priorities![k]}</span></div>
                  <Slider label={k} value={form.priorities![k]} onChange={(v) => setForm({ ...form, priorities: { ...form.priorities!, [k]: v } })} />
                </div>
              ))}
              <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save and replan</Button></div>
            </form>
          )}
        </Card>
        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Appearance</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {([["light", Sun], ["dark", Moon], ["system", Monitor]] as const).map(([t, Icon]) => (
                <button key={t} onClick={() => { applyTheme(t); setTheme(t); }} aria-pressed={theme === t}
                  className={cn("flex flex-col items-center gap-1.5 rounded-card border p-3 text-[13px] capitalize", theme === t ? "border-orange bg-orange-tint" : "border-border hover:bg-surface-2")}>
                  <Icon className="size-5" /> {t}
                </button>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <SectionTitle>Integrations</SectionTitle>
            {!config.data ? <Skeleton className="h-40" /> : (
              <ul className="space-y-3">
                {Object.entries(INTEGRATIONS).map(([k, meta]) => {
                  const st = config.data!.integrations[k];
                  const live = !!st?.live;
                  return (
                    <li key={k} className="flex items-start gap-3">
                      {live ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" />}
                      <div className="min-w-0 flex-1 text-[14px]">
                        <div className="flex items-center gap-2 font-medium">{meta.label} <Badge tone={live ? "success" : "warning"} className="h-5">{live ? (st.mode === "test" ? "Test mode" : "Live") : "Fallback"}</Badge></div>
                        <div className="text-[12px] text-ink-2">{live ? `${st.provider}${st.model ? ` · ${st.model}` : ""}` : meta.off}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-[12px] text-ink-2">Every service has a fallback, so the app keeps working when one is down.</p>
          </Card>
          <Card className="p-5">
            <SectionTitle>Account</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {config.data?.demo_mode && <Button variant="secondary" onClick={reset} loading={resetting} data-testid="reset-demo"><RotateCcw /> Reset demo</Button>}
              <Button variant="ghost" onClick={() => { signOut(); navigate("/login"); }}><LogOut /> Sign out</Button>
            </div>
            {config.data?.demo_mode && <p className="mt-2 text-[12px] text-ink-2">Reset demo restores Maya's move: 14 items, 10 arrival needs, 6 vendors and city rules. It signs you in as Maya.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
