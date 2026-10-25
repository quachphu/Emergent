import { ExternalLink, HeartHandshake, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { assetUrl, post } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { useAction, useMatches } from "@/lib/queries";
import type { Match } from "@/lib/types";
import { DecisionBadge, EmptyState, ErrorState } from "../common";

const STATUS: Record<Match["status"], { label: string; tone: any }> = {
  suggested: { label: "Suggested", tone: "neutral" },
  offered: { label: "Offer sent", tone: "orange" },
  accepted: { label: "Pickup set", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
};

export default function HandoffMatches() {
  const matches = useMatches();
  const offer = useAction((id: string) => post(`/matches/${id}/offer`), { success: "Offer drafted — approve it in the timeline or Inbox" });
  if (matches.isError) return <ErrorState error={matches.error} onRetry={() => matches.refetch()} />;
  if (matches.isLoading) return <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;
  const list = matches.data || [];
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 bg-hero p-5 text-white">
        <div>
          <div className="flex items-center gap-2 font-display text-[17px] font-semibold"><HeartHandshake className="size-5 text-orange" /> The Handoff board</div>
          <p className="mt-1 text-[14px] text-white/65">People arriving in your city post what they need. Handoff matches them with what you're letting go — free, local, out of the landfill.</p>
        </div>
        <Button variant="hero" asChild><Link to="/handoff" target="_blank"><ExternalLink /> Open the public board</Link></Button>
      </Card>
      {!list.length ? (
        <EmptyState title="No matches yet" body="When an arrival needs something you're letting go, it shows up here." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((m) => (
            <li key={m.id}>
              <Card className="flex gap-4 p-4">
                <img src={assetUrl(m.item.photos?.[0])} alt="" className="size-20 shrink-0 rounded-ctl bg-surface-2 object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.item.name} <span className="text-ink-2">→</span> {m.need.arrival_name}</div>
                      <div className="truncate text-[13px] text-ink-2">Needs “{m.need.item_wanted}” · {m.need.neighborhood || m.need.city}{m.need.needed_by ? ` · by ${shortDate(m.need.needed_by)}` : ""}</div>
                    </div>
                    <span className="shrink-0 font-display text-[15px] font-bold tabular text-orange-text">{Math.round(m.score * 100)}%</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <DecisionBadge decision={m.item.decision} />
                    <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}{m.pickup_window ? ` · ${m.pickup_window}` : ""}</Badge>
                    {m.status === "suggested" && <Button size="sm" className="ml-auto" onClick={() => offer.mutate(m.id)} loading={offer.isPending}><Send /> Offer it</Button>}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-ink-2">Match % blends how similar the need is to your item, whether they're in your city, and whether their date works.</p>
    </div>
  );
}
