import * as D from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { Check, Clock, CreditCard, Loader2, MessageSquareText, Package, Star, Truck, Zap } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/misc";
import { post } from "@/lib/api";
import { money } from "@/lib/format";
import { approveStep, useAction, useInvalidateAll, useJobs, useSteps } from "@/lib/queries";
import type { Job, Quote, Step } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "../common";
import { PulseDot } from "../motion";
import { StepTimeline } from "../StepTimeline";

const JOB_LABEL: Record<Job["type"], string> = { haul: "Haul-away", mover: "Movers", auto_transport: "Car shipping" };

export function QuoteCard({ quote, best, fastest, booked, onBook, busy }: { quote: Quote; best?: boolean; fastest?: boolean; booked?: boolean; onBook: () => void; busy?: boolean }) {
  const declined = quote.status === "declined";
  return (
    <motion.div layout initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
      <Card className={cn("relative flex h-full flex-col p-5", best && !booked && "border-2 border-orange shadow-lift", quote.status === "booked" && "border-2 border-success", declined && "opacity-60")} data-testid="quote-card">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-display text-[16px] font-semibold">{quote.vendor_name}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-2">
              <span className="flex items-center gap-0.5"><Star className="size-3.5 fill-warning text-warning" /> {quote.vendor_rating}</span>
              {quote.response_minutes != null && <span>· replied in {quote.response_minutes} min</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {best && <Badge tone="orange">Best price</Badge>}
            {fastest && <Badge tone="neutral"><Zap /> Earliest</Badge>}
          </div>
        </div>
        <div className="mt-4 font-display text-[36px] font-bold leading-none tabular">{quote.price ? money(quote.price) : "—"}</div>
        <div className="mt-3 space-y-1.5 text-[13.5px]">
          {quote.eta && <div className="flex items-center gap-2"><Clock className="size-4 text-ink-2" /> {quote.eta}</div>}
          {quote.notes && <div className="flex items-start gap-2"><Truck className="mt-0.5 size-4 shrink-0 text-ink-2" /> {quote.notes}</div>}
        </div>
        <details className="mt-3 text-[13px] text-ink-2">
          <summary className="flex cursor-pointer items-center gap-1.5 hover:text-ink"><MessageSquareText className="size-3.5" /> Their SMS</summary>
          <p className="mt-1.5 rounded-ctl bg-surface-2 p-2.5 font-mono text-[12px] text-ink">{quote.message_text}</p>
        </details>
        <div className="mt-auto pt-5">
          {quote.status === "booked" ? (
            <div className="flex items-center gap-2 rounded-ctl bg-success/10 px-3 py-2.5 text-[14px] font-medium text-success"><Check className="size-4" /> Booked & paid</div>
          ) : booked || declined ? (
            <div className="text-center text-[13px] text-ink-2">{declined ? "Couldn't take the job" : "Not selected"}</div>
          ) : (
            <Button className="w-full" variant={best ? "primary" : "secondary"} onClick={onBook} loading={busy} data-testid="book-quote"><CreditCard /> Book with Stripe</Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

function PayDialog({ step, onClose }: { step: Step | null; onClose: () => void }) {
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    if (!step) return;
    setBusy(true);
    try {
      const out = await approveStep(step.id);
      invalidate();
      const url = out.receipt?.url;
      if (url && /^https?:/.test(url)) window.location.href = url;
      else if (url) navigate(url);
      else toast.error("Couldn't open checkout. Retry from the timeline.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <D.Root open={!!step} onOpenChange={(o) => !o && onClose()}>
      {step && (
        <DialogContent title={step.title} description="Approve the payment. You'll finish on a Stripe test-mode checkout page.">
          <div className="rounded-ctl border border-orange/30 bg-orange-tint/50 p-3.5 text-[14px] leading-relaxed">{step.gate?.preview}</div>
          <p className="mt-3 text-[13px] text-ink-2">Test card: <span className="font-mono">4242 4242 4242 4242</span>, any future date, any CVC.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Not now</Button>
            <Button onClick={pay} loading={busy} data-testid="approve-pay"><CreditCard /> Approve & pay</Button>
          </div>
        </DialogContent>
      )}
    </D.Root>
  );
}

export function Quotes() {
  const jobs = useJobs();
  const steps = useSteps({ lane: "transport" });
  const waitingSteps = (steps.data || []).filter((s) => s.state === "waiting_for_user" && s.gate?.handler !== "pay_quote");
  const [payStep, setPayStep] = useState<Step | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const request = useAction((type: string) => post("/jobs", { type }), { success: "Job package ready — approve the texts in the timeline" });
  const book = async (q: Quote) => {
    setBooking(q.id);
    try {
      setPayStep(await post<Step>(`/quotes/${q.id}/book`));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBooking(null);
    }
  };
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />;
  if (jobs.isLoading) return <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div>;
  const list = jobs.data || [];
  const has = (t: string) => list.some((j) => j.type === t);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        {!has("haul") && <Button onClick={() => request.mutate("haul")} loading={request.isPending}><Package /> Get haul-away quotes</Button>}
        {!has("mover") && <Button variant="secondary" onClick={() => request.mutate("mover")} loading={request.isPending}><Truck /> Get mover quotes</Button>}
      </div>
      {waitingSteps.length > 0 && (
        <Card className="border-2 border-orange p-5">
          <div className="mb-3 font-display text-[16px] font-semibold">Waiting for your OK</div>
          <StepTimeline steps={waitingSteps} showLane={false} />
        </Card>
      )}
      {!list.length && <EmptyState title="No quote requests yet" body="Handoff bundles everything marked Haul into one job, texts local haulers after you approve, and lines up the replies here." />}
      {list.map((job) => {
        const priced = job.quotes.filter((q) => q.price && q.status !== "declined");
        const min = Math.min(...priced.map((q) => q.price!));
        const bookedJob = job.status === "booked";
        const waiting = job.status === "sent" && job.quotes.length < 3;
        return (
          <section key={job.id}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-display text-[18px] font-semibold">{JOB_LABEL[job.type]} · {job.package.item_list.length || 1} item{job.package.item_list.length === 1 ? "" : "s"}</h3>
                <p className="text-[13px] text-ink-2">{job.package.item_list.map((i) => i.name).join(", ") || "Car"} · ~{job.package.volume} cu ft · {job.package.time_window}</p>
              </div>
              <Badge tone={bookedJob ? "success" : job.status === "sent" ? "orange" : "neutral"}>
                {bookedJob ? "Booked" : job.status === "sent" ? (waiting ? <><PulseDot className="mr-1" /> Waiting for replies</> : "Quotes in") : "Waiting for your OK to text vendors"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {job.quotes.map((q) => (
                <QuoteCard key={q.id} quote={q} best={!!q.price && q.price === min && priced.length > 1} fastest={false} booked={bookedJob} onBook={() => book(q)} busy={booking === q.id} />
              ))}
              {waiting && Array.from({ length: 3 - job.quotes.length }).map((_, i) => (
                <Card key={i} className="flex h-full min-h-[260px] flex-col items-center justify-center border-dashed p-5 text-center text-ink-2">
                  <Loader2 className="size-5 animate-spin" /><div className="mt-2 text-[13px]">Waiting for a reply…</div>
                </Card>
              ))}
            </div>
            {job.booking?.status === "paid" && (
              <p className="mt-3 text-[13px] text-success">Paid {money(job.booking.amount, { cents: true })}{job.booking.receipt_url ? <> · <a className="underline" href={job.booking.receipt_url} target="_blank" rel="noreferrer">Stripe receipt</a></> : ""}. The vendor was notified.</p>
            )}
          </section>
        );
      })}
      <PayDialog step={payStep} onClose={() => setPayStep(null)} />
    </div>
  );
}
