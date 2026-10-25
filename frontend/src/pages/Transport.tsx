import { Car, ListChecks, Scale, Truck } from "lucide-react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/common";
import { LanePlan } from "@/components/LanePlan";
import { LaneSteps } from "@/components/LaneSteps";
import { CityRules } from "@/components/transport/CityRules";
import { Quotes } from "@/components/transport/Quotes";
import { Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { post } from "@/lib/api";
import { laneMeta } from "@/lib/format";
import { useInvalidateAll } from "@/lib/queries";

const CarPanel = lazy(() => import("@/components/transport/CarPanel"));

export default function Transport() {
  const [params, setParams] = useSearchParams();
  const invalidate = useInvalidateAll();
  const handled = useRef(false);
  const tab = params.get("tab") || "quotes";
  const meta = laneMeta("transport");

  useEffect(() => {
    const booking = params.get("booking");
    if (!booking || handled.current) return;
    handled.current = true;
    (async () => {
      if (params.get("cancelled")) toast("Checkout cancelled — nothing was charged.");
      else if (params.get("paid")) toast.success("Booked and paid", { description: "The receipt is in your timeline." });
      else {
        try {
          const qs = params.get("session_id") ? `?session_id=${encodeURIComponent(params.get("session_id")!)}` : "";
          const b = await post<{ status: string }>(`/bookings/${booking}/confirm${qs}`);
          if (b.status === "paid") toast.success("Payment confirmed by Stripe", { description: "Receipt added to your timeline." });
          else toast("Waiting for Stripe to confirm the payment…");
        } catch (e: any) {
          toast.error(e.message);
        }
      }
      invalidate();
      setParams({ tab: "quotes" }, { replace: true });
    })();
  }, [params, setParams, invalidate]);

  return (
    <div>
      <PageHeader emoji={meta.emoji} title="Transport" subtitle="One bundled job, quotes from local haulers and movers side by side, booked and paid with Stripe after you approve." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="quotes"><Truck /> Quotes</TabsTrigger>
          <TabsTrigger value="rules"><Scale /> City rules</TabsTrigger>
          <TabsTrigger value="car"><Car /> Car</TabsTrigger>
          <TabsTrigger value="plan"><ListChecks /> Plan</TabsTrigger>
        </TabsList>
        <TabsContent value="quotes"><div className="grid gap-6 2xl:grid-cols-[1fr_380px]"><Quotes /><div className="hidden 2xl:block"><LaneSteps lane="transport" limit={8} /></div></div></TabsContent>
        <TabsContent value="rules"><CityRules /></TabsContent>
        <TabsContent value="car"><Suspense fallback={<Skeleton className="h-64" />}><CarPanel /></Suspense></TabsContent>
        <TabsContent value="plan"><div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"><LanePlan lane="transport" /><LaneSteps lane="transport" /></div></TabsContent>
      </Tabs>
    </div>
  );
}
