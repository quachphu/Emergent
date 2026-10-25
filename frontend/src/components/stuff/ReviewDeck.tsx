import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Heart, Package, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";
import { assetUrl, post } from "@/lib/api";
import { DECISION_META, money, range } from "@/lib/format";
import { useInvalidateAll } from "@/lib/queries";
import type { Item } from "@/lib/types";
import { DecisionBadge, EmptyState, EstimateNote } from "../common";

type Dir = "keep" | "let_go" | "accept";

function DeckCard({ item, onDecide, depth }: { item: Item; onDecide: (d: Dir) => void; depth: number }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-12, 12]);
  const keepOpacity = useTransform(x, [30, 140], [0, 1]);
  const goOpacity = useTransform(x, [-140, -30], [1, 0]);
  const top = depth === 0;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 120 || info.velocity.x > 700) onDecide("keep");
    else if (info.offset.x < -120 || info.velocity.x < -700) onDecide("let_go");
  };
  const sugg = item.suggestion;
  return (
    <motion.div
      className="absolute inset-0"
      style={{ x: top ? x : 0, rotate: top ? rotate : 0, zIndex: 10 - depth }}
      drag={top ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={onDragEnd}
      initial={{ scale: 0.94 - depth * 0.03, y: 18 + depth * 12, opacity: 0 }}
      animate={{ scale: 1 - depth * 0.04, y: depth * 14, opacity: depth > 2 ? 0 : 1 }}
      exit={{ x: x.get() >= 0 ? 520 : -520, opacity: 0, rotate: x.get() >= 0 ? 16 : -16, transition: { duration: 0.3 } }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      aria-hidden={!top}
    >
      <div className="flex h-full cursor-grab select-none flex-col overflow-hidden rounded-[20px] border border-border bg-surface shadow-lift active:cursor-grabbing">
        <div className="relative aspect-[4/3] shrink-0 bg-surface-2">
          {item.photos?.[0] ? <img src={assetUrl(item.photos[0])} alt={item.name} draggable={false} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Package className="size-12 text-ink-2" /></div>}
          {top && (
            <>
              <motion.div style={{ opacity: keepOpacity }} className="absolute left-5 top-5 rotate-[-10deg] rounded-ctl border-[3px] border-success bg-surface/90 px-3 py-1 font-display text-[22px] font-bold text-success">KEEP</motion.div>
              <motion.div style={{ opacity: goOpacity }} className="absolute right-5 top-5 rotate-[10deg] rounded-ctl border-[3px] border-orange bg-surface/90 px-3 py-1 font-display text-[22px] font-bold text-orange-text">LET GO</motion.div>
            </>
          )}
        </div>
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-display text-[22px] font-bold">{item.name}</h3>
              <div className="text-[13px] text-ink-2">{[item.brand_guess, item.category, `condition ${item.condition}/5`].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-[20px] font-bold tabular">{range(item.resale_low, item.resale_high)}</div>
              <div className="text-[11px] text-ink-2">resale estimate</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
            <div className="rounded-ctl bg-surface-2 px-3 py-2"><span className="text-ink-2">Move it: </span><span className="font-semibold tabular">{money(item.move_cost_estimate)}</span></div>
            <div className="rounded-ctl bg-surface-2 px-3 py-2"><span className="text-ink-2">Replace: </span><span className="font-semibold tabular">{money(item.replacement_cost_estimate)}</span></div>
          </div>
          {sugg && (
            <div className="mt-3 rounded-ctl border border-orange/30 bg-orange-tint/60 p-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-orange-text"><Sparkles className="size-3.5" /> Handoff suggests <DecisionBadge decision={sugg.decision} /></div>
              <p className="mt-1 text-[13.5px]">{sugg.reason}</p>
            </div>
          )}
          <EstimateNote className="mt-auto pt-2" />
        </div>
      </div>
    </motion.div>
  );
}

export function ReviewDeck({ items }: { items: Item[] }) {
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const [all, setAll] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const queue = useMemo(() => items.filter((i) => (all || !i.decision) && !gone.has(i.id)), [items, all, gone]);
  const top = queue[0];

  const decide = useCallback(
    async (dir: Dir) => {
      if (!top) return;
      setGone((g) => new Set(g).add(top.id));
      try {
        const out = await post<Item>(`/items/${top.id}/decide`, { direction: dir });
        const d = out.decision ? DECISION_META[out.decision] : null;
        toast(d ? `${out.name} → ${d.label}` : out.name, { description: out.decision_reason || undefined });
        invalidate();
      } catch (e: any) {
        toast.error(e.message);
        setGone((g) => {
          const n = new Set(g);
          n.delete(top.id);
          return n;
        });
      }
    },
    [top, invalidate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); decide("keep"); }
      if (e.key === "ArrowLeft") { e.preventDefault(); decide("let_go"); }
      if (e.key === "Enter" && top?.suggestion) { e.preventDefault(); decide("accept"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, top]);

  const undecided = items.filter((i) => !i.decision).length;
  if (!items.length) return <EmptyState title="Nothing to review yet" body="Scan a room first — every item you photograph lands here." />;
  if (!top)
    return (
      <EmptyState art="inbox" title="Every item has a decision" body={`${items.length} items sorted. Handoff can now plan sales, handoffs, pickups and hauling.`}
        action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={() => navigate("/run?propose=1")}>Ask Handoff for a plan</Button><Button variant="secondary" onClick={() => { setGone(new Set()); setAll(true); }}>Review all again</Button></div>} />
    );

  return (
    <div className="mx-auto max-w-[440px]">
      <div className="mb-3 flex items-center justify-between text-[13px] text-ink-2">
        <span>{queue.length} to go{all ? " (reviewing all)" : ""}</span>
        <span className="hidden items-center gap-1.5 sm:flex"><Kbd>←</Kbd> let go <Kbd>→</Kbd> keep <Kbd>⏎</Kbd> suggestion</span>
      </div>
      <div className="relative h-[560px]" data-testid="review-deck">
        <AnimatePresence initial={false}>
          {queue.slice(0, 3).reverse().map((it) => <DeckCard key={it.id} item={it} depth={queue.indexOf(it)} onDecide={decide} />)}
        </AnimatePresence>
      </div>
      <div className="mt-5 flex items-center justify-center gap-3">
        <Button size="lg" variant="secondary" onClick={() => decide("let_go")} aria-label="Let go"><ArrowLeft /><X /> Let go</Button>
        {top.suggestion && <Button size="lg" variant="dark" onClick={() => decide("accept")} aria-label="Use suggestion"><Check /> {DECISION_META[top.suggestion.decision].verb}</Button>}
        <Button size="lg" variant="secondary" onClick={() => decide("keep")} aria-label="Keep"><Heart /> Keep <ArrowRight /></Button>
      </div>
      {undecided === 0 && !all && null}
    </div>
  );
}
