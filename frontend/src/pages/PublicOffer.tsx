import { useQuery } from "@tanstack/react-query";
import { Check, MapPin } from "lucide-react";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ErrorState } from "@/components/common";
import { PublicShell } from "@/components/PublicShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { api, assetUrl, post } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function PublicOffer() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const t = params.get("t") || "";
  const q = useQuery({ queryKey: ["offer", id], queryFn: () => api<{ item: string; photos: string[]; pickup_windows: string[]; area: string; status: string; pickup_window?: string }>(`/public/matches/${id}?t=${t}`), retry: false });
  const [win, setWin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      await post(`/public/matches/${id}/accept?t=${t}`, { window: win });
      await q.refetch();
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  return (
    <PublicShell>
      {q.isError ? <ErrorState error={q.error} /> : !d ? <Skeleton className="h-96" /> : (
        <Card className="mx-auto max-w-lg overflow-hidden">
          {d.photos[0] && <img src={assetUrl(d.photos[0])} alt={d.item} className="aspect-[4/3] w-full object-cover" />}
          <div className="p-6">
            <h1 className="text-[26px] font-bold">A free {d.item.toLowerCase()} for you</h1>
            <p className="mt-1 flex items-center gap-1.5 text-ink-2"><MapPin className="size-4" /> Pickup in {d.area}</p>
            {d.status === "accepted" ? (
              <div className="mt-5 flex items-center gap-3 rounded-card bg-success/10 p-4"><Check className="size-5 text-success" /> You're set for {d.pickup_window}. The exact address comes the day before.</div>
            ) : (
              <>
                <div className="mt-5 text-[14px] font-medium">Pick a window</div>
                <div className="mt-2 grid gap-2">
                  {d.pickup_windows.map((w) => (
                    <button key={w} onClick={() => setWin(w)} className={cn("rounded-ctl border px-4 py-3 text-left text-[15px]", win === w ? "border-orange bg-orange-tint" : "border-border hover:bg-surface-2")}>{w}</button>
                  ))}
                </div>
                <Button size="lg" className="mt-5 w-full" disabled={!win} loading={busy} onClick={accept}>Claim it</Button>
              </>
            )}
          </div>
        </Card>
      )}
    </PublicShell>
  );
}
