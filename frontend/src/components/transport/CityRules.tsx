import { useQuery } from "@tanstack/react-query";
import { BellRing, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { api, assetUrl } from "@/lib/api";
import { DecisionBadge, ErrorState, SectionTitle } from "../common";

type Rule = { city: string; category: string; program: string; steps: string[]; lead_time_days: number; notes: string; source_url: string; free: boolean };

function RuleCard({ rule }: { rule: Rule }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{rule.program}</div>
        <div className="flex shrink-0 gap-1">{rule.free && <Badge tone="success">Free</Badge>}<Badge>{rule.lead_time_days ? `${rule.lead_time_days}-day lead` : "Walk-in"}</Badge></div>
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13.5px] text-ink">{rule.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {rule.notes && <p className="mt-2 text-[13px] text-ink-2">{rule.notes}</p>}
      <a href={rule.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] text-orange-text hover:underline">Official source <ExternalLink className="size-3" /></a>
    </Card>
  );
}

export function CityRules() {
  const q = useQuery({ queryKey: ["city-rules"], queryFn: () => api<{ from_city: string; to_city: string; from_rules: Rule[]; to_rules: Rule[]; per_item: { item: any; rule: Rule | null }[]; note: string }>("/city-rules") });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const d = q.data;
  return (
    <div className="space-y-8">
      {d.per_item.length > 0 && (
        <section>
          <SectionTitle>Your items</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {d.per_item.map(({ item, rule }) => (
              <Card key={item.id} className="flex gap-3 p-4">
                <img src={assetUrl(item.photos?.[0])} alt="" className="size-16 shrink-0 rounded-ctl bg-surface-2 object-cover" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="font-medium">{item.name}</span><DecisionBadge decision={item.decision} /></div>
                  <div className="text-[13px] text-ink-2">{rule ? `${rule.program} · ${rule.lead_time_days}-day lead time` : "No city program — Handoff can bundle it into a haul."}</div>
                  {item.pickup_date && <div className="mt-1 flex items-center gap-1.5 text-[13px] text-orange-text"><BellRing className="size-3.5" /> Pickup {item.pickup_date} · reminder the night before</div>}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
      <section>
        <SectionTitle>{d.from_city} (moving out)</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{d.from_rules.map((r) => <RuleCard key={r.program} rule={r} />)}</div>
      </section>
      <section>
        <SectionTitle>{d.to_city} (moving in)</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{d.to_rules.map((r) => <RuleCard key={r.program} rule={r} />)}</div>
      </section>
      <p className="text-[12px] text-ink-2">{d.note}</p>
    </div>
  );
}
