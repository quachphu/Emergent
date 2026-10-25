import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  CircleDashed,
  ExternalLink,
  Hand,
  Loader2,
  MessageSquareText,
  Pencil,
  RotateCcw,
  RotateCw,
  Undo2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { post } from "@/lib/api";
import { assetUrl } from "@/lib/api";
import { laneMeta, money, timeAgo } from "@/lib/format";
import { approveStep, useAction } from "@/lib/queries";
import type { Step } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState } from "./common";
import { PulseDot } from "./motion";

const DISCLOSURE = /^\[Sent by Handoff, an AI assistant, on behalf of [^\]]+\]\s*/;

function StateIcon({ state }: { state: Step["state"] }) {
  switch (state) {
    case "done":
      return (
        <span className="grid size-6 place-items-center rounded-full bg-success text-white">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      );
    case "running":
      return (
        <span className="grid size-6 place-items-center rounded-full bg-orange/15">
          <PulseDot />
        </span>
      );
    case "waiting_for_user":
      return (
        <span className="grid size-6 place-items-center rounded-full border-2 border-orange bg-surface">
          <Hand className="size-3 text-orange-text" />
        </span>
      );
    case "failed":
      return (
        <span className="grid size-6 place-items-center rounded-full bg-danger text-white">
          <AlertCircle className="size-3.5" />
        </span>
      );
    default:
      return (
        <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-ink-2">
          <CircleDashed className="size-3.5" />
        </span>
      );
  }
}

export function ReceiptView({ step }: { step: Step }) {
  const r = step.receipt;
  const navigate = useNavigate();
  if (!r) return null;
  const isMessage = r.kind === "sms" && r.meta?.message;
  const url = r.url;
  const external = url && /^https?:/.test(url);
  return (
    <div className="mt-2.5 overflow-hidden rounded-ctl border border-border bg-surface-2/60">
      <div className="flex gap-3 p-3">
        {r.image && <img src={assetUrl(r.image)} alt="" className="size-14 shrink-0 rounded-[6px] object-cover" />}
        <div className="min-w-0 flex-1 font-mono text-[12.5px] leading-relaxed text-ink">
          <div className="whitespace-pre-wrap break-words">{r.text}</div>
          {isMessage && (
            <details className="mt-1.5 text-ink-2">
              <summary className="cursor-pointer select-none text-[12px] hover:text-ink">Show message</summary>
              <div className="mt-1 whitespace-pre-wrap">{r.meta!.message}</div>
            </details>
          )}
        </div>
        {r.amount !== undefined && r.amount !== null && (
          <div className="shrink-0 font-display text-[15px] font-semibold tabular">{money(r.amount, { cents: r.kind === "payment" })}</div>
        )}
      </div>
      {url && (
        <div className="border-t border-border px-3 py-2">
          {external ? (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-orange-text hover:underline">
              {r.kind === "payment" ? "Open Stripe receipt" : "Open link"} <ExternalLink className="size-3" />
            </a>
          ) : (
            <button onClick={() => navigate(url)} className="inline-flex items-center gap-1 text-[12px] font-medium text-orange-text hover:underline">
              Open <ExternalLink className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GatePanel({ step }: { step: Step }) {
  const navigate = useNavigate();
  const gate = step.gate!;
  const isMessage = gate.kind === "message" && typeof gate.payload?.message === "string";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string>((gate.payload?.message || "").replace(DISCLOSURE, ""));
  const approve = useAction((msg: string | undefined) => approveStep(step.id, msg), {
    onSuccess: (out) => {
      const url = out?.receipt?.url;
      if (out?.receipt?.meta?.checkout && url) {
        if (/^https?:/.test(url)) window.location.href = url;
        else navigate(url);
      }
    },
    success: (out) => (out?.state === "failed" ? undefined : gate.kind === "payment" ? "Opening checkout…" : "Approved"),
  });
  const reject = useAction(() => post(`/steps/${step.id}/reject`), { success: "Declined — nothing was sent" });
  const takeover = useAction(() => post(`/steps/${step.id}/takeover`), { success: "You've got it" });
  const kindLabel = { message: "Message", booking: "Booking", payment: "Payment", submission: "Submission", approval: "Approval" }[gate.kind] || "Action";
  return (
    <div className="mt-3 space-y-3">
      {gate.preview && !editing && (
        <div className="rounded-ctl border border-orange/30 bg-orange-tint/50 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-orange-text">
            <MessageSquareText className="size-3.5" /> {kindLabel} preview
          </div>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{gate.preview}</p>
        </div>
      )}
      {editing && (
        <div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit message" rows={5} />
          <p className="mt-1 text-[12px] text-ink-2">Handoff adds "Sent by Handoff, an AI assistant, on behalf of you" automatically.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => approve.mutate(editing ? text : undefined)} loading={approve.isPending}>
          <Check /> {gate.cta || "Approve"}
        </Button>
        {isMessage && !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => takeover.mutate()} loading={takeover.isPending}>
          I'll do it myself
        </Button>
        <Button size="sm" variant="ghost" className="text-ink-2" onClick={() => reject.mutate()} loading={reject.isPending}>
          <X /> Decline
        </Button>
      </div>
    </div>
  );
}

function UserActionPanel({ step }: { step: Step }) {
  const navigate = useNavigate();
  const done = useAction(() => post(`/steps/${step.id}/complete`), { success: "Marked done" });
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {step.link && (
        <Button size="sm" onClick={() => navigate(step.link!)}>
          {step.cta || "Open"}
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={() => done.mutate()} loading={done.isPending}>
        <Check /> I did it
      </Button>
    </div>
  );
}

export function StepCard({ step, showLane = true }: { step: Step; showLane?: boolean }) {
  const undo = useAction(() => post(`/steps/${step.id}/undo`), { success: "Undone" });
  const retry = useAction(() => post(`/steps/${step.id}/retry`), { success: "Retrying" });
  const lane = laneMeta(step.lane);
  const waiting = step.state === "waiting_for_user";
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex gap-3 pb-4 last:pb-0"
      data-state={step.state}
      data-testid="step"
    >
      <div className="relative z-10 pt-3.5"><StateIcon state={step.state} /></div>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-card border bg-surface p-3.5 transition-colors",
          step.state === "running" && "border-orange/40 shadow-[0_0_0_3px_rgb(var(--orange)/.08)]",
          waiting && "border-2 border-orange shadow-card",
          step.state === "failed" && "border-danger/40 bg-danger/5",
          step.state === "planned" && "border-dashed border-border bg-transparent text-ink-2",
          step.state === "done" && "border-border",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={cn("text-[14.5px] font-medium leading-snug", step.state === "planned" && "text-ink-2")}>{step.title}</div>
            {step.reason && <div className="mt-0.5 text-[13px] text-ink-2"><span className="font-medium text-ink-2/80">Why: </span>{step.reason}</div>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {step.state === "running" && <Badge tone="orange"><Loader2 className="animate-spin" /> Running</Badge>}
            {waiting && <Badge tone="orange">Needs you</Badge>}
            {step.state === "failed" && <Badge tone="danger">Failed</Badge>}
            <span className="text-[11px] text-ink-2">{showLane ? `${lane.emoji} ` : ""}{timeAgo(step.updated_at)}</span>
          </div>
        </div>
        {step.receipt && step.state !== "planned" && <ReceiptView step={step} />}
        {waiting && step.gate && <GatePanel step={step} />}
        {waiting && !step.gate && <UserActionPanel step={step} />}
        {step.state === "failed" && (
          <div className="mt-3">
            {step.error && <p className="mb-2 text-[13px] text-danger">{step.error}</p>}
            <Button size="sm" variant="secondary" onClick={() => retry.mutate()} loading={retry.isPending}><RotateCw /> Retry</Button>
          </div>
        )}
        {step.state === "done" && step.undo && !step.undone && (
          <div className="mt-2">
            <Button size="sm" variant="ghost" className="-ml-2 text-ink-2" onClick={() => undo.mutate()} loading={undo.isPending}><Undo2 /> Undo</Button>
          </div>
        )}
        {step.undone && <div className="mt-2 flex items-center gap-1 text-[12px] text-ink-2"><RotateCcw className="size-3" /> Undone</div>}
      </div>
    </motion.li>
  );
}

export function StepTimeline({ steps, emptyTitle = "No agent activity yet", emptyBody, showLane = true, newestFirst = false }: { steps: Step[]; emptyTitle?: string; emptyBody?: string; showLane?: boolean; newestFirst?: boolean }) {
  if (!steps.length) return <EmptyState art="inbox" title={emptyTitle} body={emptyBody || "When Handoff works for you, every step shows up here with a receipt."} />;
  const list = newestFirst ? [...steps].reverse() : steps;
  return (
    <ol className="relative" aria-live="polite" aria-label="Agent steps">
      <div className="absolute bottom-3 left-3 top-3 w-px bg-border" aria-hidden />
      <AnimatePresence initial={false}>
        {list.map((s) => (
          <StepCard key={s.id} step={s} showLane={showLane} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
