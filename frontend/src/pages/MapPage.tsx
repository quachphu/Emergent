import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ErrorState, PageHeader } from "@/components/common";
import { PinMap, type Pin } from "@/components/maps";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/queries";
import { isDark } from "@/lib/theme";
import { cn } from "@/lib/utils";

const KINDS = [
  { kind: "sale", label: "For sale", color: "#FF6600", label1: "$" },
  { kind: "arrival", label: "Matched arrivals", color: "#2453B3", label1: "★" },
  { kind: "donation", label: "Donation sites", color: "#7A3DB8", label1: "♥" },
  { kind: "vendor", label: "Vendors", color: "#2F7D5B", label1: "🚚" },
  { kind: "home", label: "Homes", color: "#1F1E1B", label1: "⌂" },
] as const;

type ApiPin = { id: string; kind: string; lng: number; lat: number; title: string; subtitle?: string };

export default function MapPage() {
  const config = useConfig();
  const q = useQuery({ queryKey: ["map-pins"], queryFn: () => api<ApiPin[]>("/map/pins") });
  const [on, setOn] = useState<Record<string, boolean>>({ sale: true, arrival: true, donation: true, vendor: true, home: true });
  const pins: Pin[] = useMemo(
    () =>
      (q.data || [])
        .filter((p) => on[p.kind])
        .map((p) => {
          const k = KINDS.find((x) => x.kind === p.kind)!;
          return { ...p, color: k.color, label: k.label1 };
        }),
    [q.data, on],
  );
  const counts = Object.fromEntries(KINDS.map((k) => [k.kind, (q.data || []).filter((p) => p.kind === k.kind).length]));

  return (
    <div>
      <PageHeader emoji="🗺️" title="Map" subtitle="Everything in motion around your move: listings, arrivals who need your stuff, donation sites and vendors." />
      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto" role="group" aria-label="Filter pins">
        {KINDS.map((k) => (
          <button key={k.kind} onClick={() => setOn({ ...on, [k.kind]: !on[k.kind] })} aria-pressed={on[k.kind]}
            className={cn("flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-all", on[k.kind] ? "border-transparent bg-surface shadow-card" : "border-border text-ink-2 opacity-60")}>
            <span className="size-2.5 rounded-full" style={{ background: k.color }} /> {k.label}
            <span className="tabular text-ink-2">{counts[k.kind] ?? 0}</span>
          </button>
        ))}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading || config.isLoading ? (
        <Skeleton className="h-[60vh] w-full" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <PinMap pins={pins} token={config.data?.mapbox_token} dark={isDark()} className="h-[62vh] min-h-[420px]" />
          <Card className="max-h-[62vh] overflow-y-auto p-2">
            <ul>
              {pins.filter((p) => p.kind !== "home").map((p) => (
                <li key={p.id} className="flex items-start gap-3 rounded-ctl px-3 py-2.5 hover:bg-surface-2">
                  <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{p.title}</div>
                    {p.subtitle && <div className="truncate text-[12px] text-ink-2">{p.subtitle}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      <p className="mt-3 text-[12px] text-ink-2">Locations of arrivals and sites are approximate. Your exact address is never shown to others.</p>
    </div>
  );
}
