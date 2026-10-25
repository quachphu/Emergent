import { motion } from "framer-motion";
import { ArrowRight, Bot, Clock, Inbox, MapPin, Navigation, Play, ScanLine } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Countdown, ImpactCard, LaneCard, MoneyPanel, StatPill, TaskRow } from "@/components/cards";
import { EmptyState, ErrorState, SectionTitle } from "@/components/common";
import { SchematicRoute } from "@/components/SchematicRoute";
import { CountUp, ProgressRing, Stagger } from "@/components/motion";
import { usePanel } from "@/components/SidePanel";
import { StepTimeline } from "@/components/StepTimeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { patch } from "@/lib/api";
import { useAction, useSteps, useSummary } from "@/lib/queries";

function HeroSkeleton() {
  return <Skeleton className="h-[300px] w-full rounded-[20px]" />;
}

export default function CommandCenter() {
  const summary = useSummary();
  const steps = useSteps();
  const panel = usePanel();
  const navigate = useNavigate();
  const toggle = useAction(({ id, done }: { id: string; done: boolean }) => patch(`/tasks/${id}`, { status: done ? "done" : "todo" }), { success: (o: any) => (o.status === "done" ? "Nice — done" : undefined) });

  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  const s = summary.data;
  const recent = (steps.data || []).slice(-6);
  const waiting = (steps.data || []).filter((x) => x.state === "waiting_for_user");

  return (
    <div className="space-y-8">
      {!s ? (
        <HeroSkeleton />
      ) : (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[20px] bg-hero text-white shadow-lift" aria-label="Move overview">
          <SchematicRoute className="opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-r from-hero via-hero/85 to-hero/30" />
          <div className="relative z-10 grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:p-10">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-white/70">
                <MapPin className="size-4 text-orange" />
                <span>{s.move.from_area || s.move.from_city}</span>
                <ArrowRight className="size-4" />
                <span className="font-medium text-white">{s.move.to_area || s.move.to_city}</span>
              </div>
              <div className="mt-5"><Countdown days={s.days_left} date={s.move.move_date} /></div>
              <div className="mt-6 flex flex-wrap gap-2">
                {s.distance_miles != null && <StatPill icon={Navigation} label="Distance" value={`${Math.round(s.distance_miles)} mi`} />}
                {s.commute_minutes != null && <StatPill icon={Clock} label="New commute" value={`${s.commute_minutes} min`} />}
                <StatPill icon={Inbox} label="Waiting for you" value={String(s.inbox_count)} />
              </div>
              <div className="mt-7 flex flex-wrap gap-2">
                <Button size="lg" onClick={() => navigate("/run?propose=1")} data-testid="ask-plan"><Bot /> Ask Handoff for a plan</Button>
                <Button size="lg" variant="hero" onClick={() => navigate("/stuff?tab=scan")}><ScanLine /> Scan a room</Button>
                <Button size="lg" variant="hero" onClick={() => navigate("/welcome?replay=1")} aria-label="Replay map fly-through"><Play /> Fly-through</Button>
              </div>
            </div>
            <div className="flex items-center gap-5 lg:flex-col lg:items-end lg:justify-center">
              <ProgressRing value={s.resolved_pct} size={148} stroke={12}>
                <div className="text-center">
                  <div className="font-display text-[38px] font-bold leading-none tabular" data-testid="resolved-pct"><CountUp value={Math.round(s.resolved_pct * 100)} />%</div>
                  <div className="mt-1 text-[12px] text-white/60">resolved</div>
                </div>
              </ProgressRing>
              <div className="text-[13px] text-white/60 lg:text-right">
                {s.counts.items_resolved}/{s.counts.items} items handled<br />{s.counts.tasks_done}/{s.counts.tasks} tasks done
              </div>
            </div>
          </div>
        </motion.section>
      )}

      <section aria-label="Lanes">
        <SectionTitle>Five lanes</SectionTitle>
        {!s ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[190px]" />)}</div>
        ) : (
          <Stagger className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            {s.lanes.map((l) => <LaneCard key={l.lane} lane={l} />)}
          </Stagger>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle action={<Link to="/inbox" className="text-[13px] font-medium text-orange-text hover:underline">Inbox ({s?.inbox_count ?? 0})</Link>}>Today</SectionTitle>
            {!s ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : s.today.length ? (
              <div className="-mx-2">
                {s.today.map((t) => <TaskRow key={t.id} task={t} showLane onToggle={(done) => toggle.mutate({ id: t.id, done })} onOpen={() => panel.open({ type: "task", id: t.id })} />)}
              </div>
            ) : (
              <EmptyState art="inbox" title="Nothing due today" body="Enjoy it. Handoff will surface the next thing when it's time." />
            )}
          </Card>

          {waiting.length > 0 && (
            <Card className="border-2 border-orange p-5">
              <SectionTitle action={<Link to="/inbox" className="text-[13px] font-medium text-orange-text hover:underline">See all</Link>}>Waiting for your OK</SectionTitle>
              <StepTimeline steps={waiting.slice(0, 2)} />
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle action={<Link to="/run" className="text-[13px] font-medium text-orange-text hover:underline">All activity</Link>}>What Handoff did</SectionTitle>
            {steps.isLoading ? <Skeleton className="h-40" /> : <StepTimeline steps={recent} newestFirst />}
          </Card>
        </div>
        <div className="space-y-6">
          {s ? <MoneyPanel money={s.money} /> : <Skeleton className="h-56" />}
          {s && <ImpactCard impact={s.impact} />}
        </div>
      </div>
    </div>
  );
}
