import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, post } from "@/lib/api";
import { money } from "@/lib/format";
import type { Booking } from "@/lib/types";

/** In-app test checkout, used only when Stripe isn't configured or reachable. Runs the same paid handler as the webhook. */
export default function Checkout() {
  const { bookingId = "" } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["booking", bookingId], queryFn: () => api<Booking>(`/bookings/${bookingId}`) });
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [exp, setExp] = useState("12 / 34");
  const [cvc, setCvc] = useState("123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = q.data;
  useEffect(() => {
    if (b && !b.simulated && b.checkout_url && /^https?:/.test(b.checkout_url) && b.status !== "paid") window.location.href = b.checkout_url;
  }, [b]);
  const pay = async () => {
    setError(null);
    if (card.replace(/\s/g, "") !== "4242424242424242") {
      setError("Use the test card 4242 4242 4242 4242.");
      return;
    }
    setBusy(true);
    try {
      await post(`/bookings/${bookingId}/simulate-pay`);
      navigate(`/transport?booking=${bookingId}&paid=1`, { replace: true });
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-screen place-items-center bg-surface-2 p-4">
      <div className="w-full max-w-[440px]">
        <Link to="/transport" className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Back to Transport</Link>
        {q.isError ? <ErrorState error={q.error} /> : !b ? <Skeleton className="h-96" /> : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="overflow-hidden">
              <div className="border-b border-border bg-warning/10 px-5 py-2.5 text-[12px] font-medium text-warning">Test mode · simulated checkout (Stripe isn't reachable from this server)</div>
              <div className="p-6">
                <div className="text-[13px] text-ink-2">Pay {b.vendor?.name}</div>
                <div className="mt-1 font-display text-[36px] font-bold tabular">{money(b.amount, { cents: true })}</div>
                <div className="text-[13px] text-ink-2">{b.quote?.eta ? `Service ${b.quote.eta}` : "Moving service"}</div>
                {b.status === "paid" ? (
                  <div className="mt-6 flex items-center gap-2 rounded-ctl bg-success/10 p-3 text-success"><Check className="size-5" /> Already paid</div>
                ) : (
                  <div className="mt-6 space-y-3">
                    <Field label="Card number"><Input value={card} onChange={(e) => setCard(e.target.value)} inputMode="numeric" autoComplete="off" className="font-mono" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Expiry"><Input value={exp} onChange={(e) => setExp(e.target.value)} className="font-mono" /></Field>
                      <Field label="CVC"><Input value={cvc} onChange={(e) => setCvc(e.target.value)} className="font-mono" /></Field>
                    </div>
                    {error && <p className="text-[14px] text-danger">{error}</p>}
                    <Button size="lg" className="w-full" onClick={pay} loading={busy} data-testid="pay-test">Pay {money(b.amount, { cents: true })}</Button>
                    <p className="flex items-center justify-center gap-1.5 text-[12px] text-ink-2"><Lock className="size-3" /> Test card only. No real money moves.</p>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}
