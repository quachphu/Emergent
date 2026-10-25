import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, Check, Clock, Leaf, Package, PiggyBank, Sparkles, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/misc";
import { assetUrl } from "@/lib/api";
import { DECISION_META, laneMeta, longDate, money, range, relDay, STATUS_LABEL, TASK_STATUS_LABEL, daysFromToday } from "@/lib/format";
import type { Item, LaneSummary, Money, Summary, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DecisionBadge } from "./common";
import { CountUp, ProgressRing, staggerItem } from "./motion";

export function Countdown({ days, date }: { days: number; date: string }) {
  return (
    <div className="flex items-end gap-4">
      <div className="font-display text-[84px] font-bold leading-[.85] tracking-[-0.04em] text-white sm:text-[112px]">
        <CountUp value={Math.max(days, 0)} />
      </div>
      <div className="pb-2">
        <div className="text-[13px] font-semibold uppercase tracking-[.12em] text-orange">{days === 1 ? "day" : "days"} to move day</div>
        <div className="mt-1 text-[15px] text-white/70">{longDate(date)}</div>
      </div>
    </div>
  );
}

export function LaneCard({ lane, onClick }: { lane: LaneSummary; onClick?: () => void }) {
  const meta = laneMeta(lane.lane);
  return (
    <motion.div variants={staggerItem}>
      <Link to={meta.path} onClick={onClick} className="block h-full rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange">
        <Card interactive className="group flex h-full flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-11 place-items-center rounded-[10px] bg-surface-2 text-[22px]" aria-hidden>
              {lane.emoji}
            </div>
            <ProgressRing value={lane.progress} size={46} stroke={5} tone={lane.progress >= 1 ? "success" : "orange"}>
              <span className="text-[11px] font-semibold tabular">{Math.round(lane.progress * 100)}%</span>
            </ProgressRing>
          </div>
          <div className="mt-3 font-display text-[16px] font-semibold">{lane.label}</div>
          <div className="text-[13px] text-ink-2">
            {lane.done}/{lane.total} done{lane.waiting ? ` · ${lane.waiting} waiting for you` : ""}
          </div>
          <div className="mt-auto pt-3">
            {lane.next ? (
              <div className="flex items-center gap-2 rounded-ctl bg-surface-2 px-2.5 py-2 text-[13px]">
                <span className={cn("size-1.5 shrink-0 rounded-full", lane.next.tight ? "bg-danger" : "bg-orange")} />
                <span className="min-w-0 flex-1 truncate">{lane.next.title}</span>
                <span className="shrink-0 text-ink-2">{relDay(lane.next.due_date)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-ctl bg-success/10 px-2.5 py-2 text-[13px] text-success">
                <Check className="size-4" /> All set
              </div>
            )}
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}

export function TaskRow({ task, onToggle, onOpen, showLane, bare }: { task: Task; onToggle?: (done: boolean) => void; onOpen?: () => void; showLane?: boolean; bare?: boolean }) {
  const done = task.status === "done" || task.status === "skipped";
  const d = daysFromToday(task.due_date);
  const overdue = !done && d < 0;
  return (
    <div className={cn("group flex items-center gap-3 rounded-ctl px-2 py-2.5 transition-colors hover:bg-surface-2", done && "opacity-60")}>
      {onToggle ? <Checkbox checked={done} onChange={onToggle} label={`Mark ${task.title} done`} /> : null}
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onOpen}>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[15px]", done && "line-through")}>{task.title}</div>
          {(task.notes || showLane) && (
            <div className="truncate text-[13px] text-ink-2">
              {showLane && <span className="mr-1.5">{laneMeta(task.lane).emoji} {laneMeta(task.lane).label} ·</span>}
              {task.notes}
            </div>
          )}
        </div>
        {!bare && task.status === "waiting_for_user" && <Badge tone="warning">Waiting for you</Badge>}
        {!bare && task.status === "in_progress" && <Badge tone="orange">In progress</Badge>}
        {!bare && task.tight && !done && <Badge tone="danger">Tight</Badge>}
        {!bare && (
          <span className={cn("flex shrink-0 items-center gap-1 text-[13px] tabular", overdue ? "text-danger" : "text-ink-2")}>
            <CalendarClock className="size-3.5" />
            {relDay(task.due_date)}
          </span>
        )}
      </button>
    </div>
  );
}

export function TaskStatusBadge({ status }: { status: string }) {
  const tone = status === "done" ? "success" : status === "waiting_for_user" ? "warning" : status === "in_progress" ? "orange" : "neutral";
  return <Badge tone={tone as any}>{TASK_STATUS_LABEL[status] || status}</Badge>;
}

export function ItemCard({ item, onClick, compact }: { item: Item; onClick?: () => void; compact?: boolean }) {
  const photo = assetUrl(item.photos?.[0]);
  return (
    <motion.div variants={staggerItem} layout>
      <Card interactive onClick={onClick} className="group overflow-hidden" role="button" tabIndex={0} aria-label={`Open ${item.name}`}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick?.()}>
        <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
          {photo ? (
            <img src={photo} alt={item.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          ) : (
            <div className="grid h-full place-items-center text-ink-2"><Package className="size-10" /></div>
          )}
          <div className="absolute left-2.5 top-2.5"><DecisionBadge decision={item.decision} className="shadow-sm backdrop-blur" /></div>
          {item.status && STATUS_LABEL[item.status] && item.status !== "decided" && item.status !== "new" && (
            <div className="absolute right-2.5 top-2.5"><Badge tone="dark" className="shadow-sm">{STATUS_LABEL[item.status]}</Badge></div>
          )}
          {item.source === "fallback" && <div className="absolute bottom-2.5 left-2.5"><Badge tone="warning">Check name</Badge></div>}
        </div>
        <div className={cn("p-3.5", compact && "p-3")}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-display font-semibold">{item.name}</div>
              <div className="truncate text-[13px] text-ink-2">{[item.brand_guess, item.category].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display font-semibold tabular">{item.status === "sold" && item.sold_price ? money(item.sold_price) : range(item.resale_low, item.resale_high)}</div>
              <div className="text-[11px] text-ink-2">{item.status === "sold" ? "sold" : "estimate"}</div>
            </div>
          </div>
          {!compact && (item.decision_reason || item.suggestion?.reason) && (
            <p className="mt-2 line-clamp-2 text-[13px] text-ink-2">
              <Sparkles className="mr-1 inline size-3.5 text-orange-text" />
              {item.decision_reason || item.suggestion?.reason}
            </p>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

export function MoneyPanel({ money: m, className }: { money: Money; className?: string }) {
  const rows = [
    { icon: Wallet, label: "Earned", value: m.earned, tone: "text-success", hint: m.potential_high ? `+${range(m.potential_low, m.potential_high)} listed` : undefined },
    { icon: PiggyBank, label: "Saved", value: m.saved, tone: "text-ink", hint: "estimate" },
    { icon: Clock, label: "Spent", value: m.spent, tone: "text-ink" },
  ];
  const usedPct = m.budget ? Math.min(1, m.spent / m.budget) : 0;
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold">Money</h3>
        <span className="text-[12px] text-ink-2">Budget {money(m.budget)}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-center gap-1.5 text-[12px] text-ink-2"><r.icon className="size-3.5" />{r.label}</div>
            <div className={cn("mt-1 font-display text-[22px] font-bold tabular", r.tone)}>
              <CountUp value={r.value} format={(n) => money(n)} />
            </div>
            {r.hint && <div className="text-[11px] text-ink-2">{r.hint}</div>}
          </div>
        ))}
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-ink-2">Budget left</span>
          <span className="font-semibold tabular">{money(m.budget_left)}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <motion.div className="h-full rounded-full bg-orange" initial={{ width: 0 }} animate={{ width: `${usedPct * 100}%` }} transition={{ duration: 0.8 }} />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-ink-2">{m.label}</p>
    </Card>
  );
}

export function ImpactCard({ impact }: { impact: Summary["impact"] }) {
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="absolute -right-6 -top-6 size-28 rounded-full bg-success/10" aria-hidden />
      <div className="flex items-center gap-2 text-[13px] font-semibold text-success"><Leaf className="size-4" /> Impact</div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <div className="font-display text-[24px] font-bold tabular"><CountUp value={impact.items_rehomed} /></div>
          <div className="text-[12px] text-ink-2">items rehomed</div>
        </div>
        <div>
          <div className="font-display text-[24px] font-bold tabular"><CountUp value={impact.money_earned} format={(n) => money(n)} /></div>
          <div className="text-[12px] text-ink-2">earned</div>
        </div>
        <div>
          <div className="font-display text-[24px] font-bold tabular"><CountUp value={impact.pounds_diverted} /></div>
          <div className="text-[12px] text-ink-2">lbs kept from landfill</div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-ink-2">{impact.label}</p>
    </Card>
  );
}

export function StatPill({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-white/8 px-3.5 py-2 ring-1 ring-white/10 backdrop-blur">
      <Icon className="size-4 text-orange" />
      <span className="text-[13px] text-white/60">{label}</span>
      <span className="text-[13px] font-semibold text-white tabular">{value}</span>
    </div>
  );
}

export function LinkArrow({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-[13px] font-medium text-orange-text hover:underline">
      {children} <ArrowRight className="size-3.5" />
    </Link>
  );
}

export function DecisionLegend() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(DECISION_META).map(([k, v]) => (
        <span key={k} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", v.tone)}>{v.label}</span>
      ))}
    </div>
  );
}
