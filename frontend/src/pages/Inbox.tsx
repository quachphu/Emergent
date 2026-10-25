import { Check, MessageSquare } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, SectionTitle } from "@/components/common";
import { StepTimeline } from "@/components/StepTimeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { post } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useAction, useInbox } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function InboxPage() {
  const inbox = useInbox();
  const accept = useAction(({ listing, req }: { listing: string; req: string }) => post(`/listings/${listing}/interest/${req}/accept`), { success: "Reply drafted — approve it below" });
  if (inbox.isError) return <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />;
  const d = inbox.data;
  return (
    <div>
      <PageHeader emoji="📥" title="Inbox" subtitle="Everything waiting for your OK, pickup requests from buyers, and every message Handoff sent or received on your behalf." />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Waiting for you {d && <Badge tone="orange" className="ml-1">{d.waiting.length}</Badge>}</SectionTitle>
            {!d ? <Skeleton className="h-40" /> : <StepTimeline steps={d.waiting} emptyTitle="You're all caught up" emptyBody="When Handoff needs your OK to send, book or pay, it shows up here." />}
          </Card>
          {d && d.requests.length > 0 && (
            <Card className="p-5">
              <SectionTitle>Pickup requests</SectionTitle>
              <ul className="space-y-2">
                {d.requests.map((r: any) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-border p-3">
                    <div>
                      <div className="font-medium">{r.name} · <span className="text-ink-2">{r.listing_title}</span></div>
                      <div className="text-[13px] text-ink-2">Wants pickup {r.proposed_time}{r.message ? ` — “${r.message}”` : ""}</div>
                    </div>
                    <Button size="sm" onClick={() => accept.mutate({ listing: r.listing_id, req: r.id })} loading={accept.isPending}><Check /> Accept time</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card className="p-5">
          <SectionTitle>Messages</SectionTitle>
          {!d ? <Skeleton className="h-60" /> : !d.messages.length ? <EmptyState art="inbox" title="No messages yet" /> : (
            <ul className="space-y-3">
              {d.messages.map((m: any) => (
                <li key={m.id} className={cn("flex", m.direction === "in" ? "justify-start" : "justify-end")}>
                  <div className={cn("max-w-[88%] rounded-[14px] px-3.5 py-2.5 text-[13.5px]", m.direction === "in" ? "rounded-bl-[4px] bg-surface-2" : "rounded-br-[4px] bg-orange-tint")}>
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
                      <MessageSquare className="size-3" /> {m.direction === "in" ? `From ${m.from}` : `To ${m.to}`} · {m.channel}{m.status ? ` · ${m.status}` : ""} · {timeAgo(m.created_at)}
                    </div>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
