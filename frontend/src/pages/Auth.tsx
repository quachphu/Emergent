import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SchematicRoute } from "@/components/maps";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LANES } from "@/lib/format";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function AuthPage({ initialMode = "login" }: { initialMode?: "login" | "signup" }) {
  const { user, hasMove, signIn, startDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={hasMove ? location.state?.from || "/" : "/setup"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = mode === "signup" ? await post<{ token: string; user: User }>("/auth/signup", { name, email, password }) : await post<{ token: string; user: User }>("/auth/login", { email, password });
      await signIn(r.token, r.user);
      navigate(mode === "signup" ? "/setup" : "/", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setDemoBusy(true);
    try {
      await startDemo();
      navigate("/", { replace: true });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-hero text-white lg:block">
        <SchematicRoute className="opacity-40 [mask-image:linear-gradient(to_left,black,transparent_85%)]" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-[10px] bg-orange"><svg viewBox="0 0 24 24" className="size-5"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#1F1E1B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span className="font-display text-xl font-bold">Handoff</span>
          </div>
          <div className="max-w-lg">
            <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-[56px] font-bold leading-[1.02] tracking-[-0.03em]">
              Your move,<br /><span className="text-orange">on autopilot.</span>
            </motion.h1>
            <p className="mt-5 text-[17px] leading-relaxed text-white/70">
              Handoff plans five jobs backward from move day, does the legwork with AI agents, and shows you every step. You approve anything that commits you.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {LANES.map((l, i) => (
                <motion.span key={l.lane} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.08 }}
                  className="rounded-full bg-white/8 px-3.5 py-2 text-[14px] ring-1 ring-white/10 backdrop-blur">
                  {l.emoji} {l.label}
                </motion.span>
              ))}
            </div>
          </div>
          <p className="text-[13px] text-white/40">You sign, show IDs and do banking yourself — always.</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <h1 className="text-[34px] font-bold leading-tight">Your move, <span className="text-orange-text">on autopilot.</span></h1>
            <p className="mt-2 text-ink-2">AI agents plan and run your relocation. You approve every commitment.</p>
          </div>
          <div className="mb-6 inline-flex rounded-[10px] bg-surface-2 p-1" role="tablist">
            {(["login", "signup"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}
                className={cn("h-9 rounded-[7px] px-4 text-[14px] font-medium transition-all", mode === m ? "bg-surface shadow-sm" : "text-ink-2 hover:text-ink")}>
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-4" noValidate>
            {mode === "signup" && (
              <Field label="Your name" htmlFor="name"><Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Maya Chen" /></Field>
            )}
            <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" /></Field>
            <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
              <Input id="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </Field>
            {error && <p role="alert" className="rounded-ctl bg-danger/10 px-3 py-2 text-[14px] text-danger">{error}</p>}
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              {mode === "signup" ? "Create account" : "Sign in"} <ArrowRight />
            </Button>
          </form>
          <div className="my-6 flex items-center gap-3 text-[12px] text-ink-2"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
          <Button variant="dark" size="lg" className="w-full" onClick={demo} loading={demoBusy} data-testid="try-demo">
            <Sparkles /> Try the demo as Maya
          </Button>
          <p className="mt-3 text-center text-[13px] text-ink-2">New grad · Long Beach → San Francisco · 12 days to go</p>
        </div>
      </section>
    </div>
  );
}
