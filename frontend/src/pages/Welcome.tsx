import { motion } from "framer-motion";
import { ArrowRight, Briefcase, CalendarDays, Navigation, SkipForward } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FlyThrough } from "@/components/maps";
import { CountUp } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { patch } from "@/lib/api";
import { longDate } from "@/lib/format";
import { useConfig, useSummary } from "@/lib/queries";

export default function Welcome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const replay = params.get("replay") === "1";
  const summary = useSummary();
  const config = useConfig();
  const [finished, setFinished] = useState(false);
  const s = summary.data;
  const ready = s && config.data && s.move.from_geo && s.move.to_geo;

  const leave = async () => {
    try {
      if (!replay) await patch("/moves/current", { onboarded: true });
    } catch {
      /* non-blocking */
    }
    navigate("/", { replace: true });
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-hero text-white">
      {ready ? (
        <FlyThrough
          from={s!.move.from_geo!}
          to={s!.move.to_geo!}
          work={s!.move.work_geo}
          token={config.data!.mapbox_token}
          fromLabel={s!.move.from_area}
          toLabel={s!.move.to_area}
          onDone={() => setFinished(true)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-white/60">{s && !s.move.to_geo ? "We couldn't place your addresses on a map." : "Loading your route…"}</div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-hero via-transparent to-hero/60" />

      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-5 sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[9px] bg-orange"><svg viewBox="0 0 24 24" className="size-[18px]"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#1F1E1B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span className="font-display text-[17px] font-bold">Handoff</span>
        </div>
        <Button variant="hero" onClick={leave} data-testid="skip-flythrough"><SkipForward /> Skip</Button>
      </div>

      {s && (
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.6 }}
          className="absolute inset-x-0 bottom-0 z-10 p-4 sm:p-8">
          <div className="mx-auto max-w-3xl rounded-[20px] bg-black/55 p-5 ring-1 ring-white/10 backdrop-blur-xl sm:p-7">
            <div className="text-[13px] font-semibold uppercase tracking-[.12em] text-orange">Your route</div>
            <h1 className="mt-1 text-[26px] font-bold leading-tight sm:text-[34px]">
              {s.move.from_area || s.move.from_city} <span className="text-white/40">→</span> {s.move.to_area || s.move.to_city}
            </h1>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[12px] text-white/55"><Navigation className="size-3.5" /> Distance</div>
                <div className="mt-1 font-display text-[26px] font-bold tabular sm:text-[32px]">{s.distance_miles != null ? <><CountUp value={Math.round(s.distance_miles)} /> <span className="text-[15px] font-medium text-white/60">mi</span></> : "—"}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[12px] text-white/55"><CalendarDays className="size-3.5" /> Days left</div>
                <div className="mt-1 font-display text-[26px] font-bold tabular sm:text-[32px]"><CountUp value={s.days_left} /></div>
                <div className="text-[12px] text-white/50">{longDate(s.move.move_date)}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[12px] text-white/55"><Briefcase className="size-3.5" /> Commute</div>
                <div className="mt-1 font-display text-[26px] font-bold tabular sm:text-[32px]">{s.commute_minutes != null ? <><CountUp value={s.commute_minutes} /> <span className="text-[15px] font-medium text-white/60">min</span></> : "—"}</div>
                <div className="text-[12px] text-white/50">to work, estimate</div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[14px] text-white/60">Your plan is ready: {s.counts.tasks} dated tasks across five lanes.</p>
              <Button size="lg" onClick={leave} className={finished ? "shadow-glow" : ""} data-testid="go-command-center">Open Command Center <ArrowRight /></Button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
