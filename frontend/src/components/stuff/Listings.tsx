import * as D from "@radix-ui/react-dialog";
import { Copy, ExternalLink, Link2, Tag } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { assetUrl, post } from "@/lib/api";
import { money, shortDate, daysFromToday } from "@/lib/format";
import { useAction, useItems, useListings } from "@/lib/queries";
import type { Listing } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, EstimateNote } from "../common";

function PriceTimeline({ listing }: { listing: Listing }) {
  const pts = listing.price_schedule;
  return (
    <div className="mt-3">
      <div className="flex items-end gap-1">
        {pts.map((p, i) => {
          const active = p.price === listing.current_price && listing.status === "active";
          const past = daysFromToday(p.date) < 0;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className={cn("text-[12px] font-semibold tabular", active ? "text-orange-text" : past ? "text-ink-2 line-through" : "text-ink")}>{money(p.price)}</div>
              <div className={cn("w-full rounded-t-[4px]", active ? "bg-orange" : "bg-surface-2")} style={{ height: 10 + (p.price / pts[0].price) * 26 }} />
              <div className="text-[11px] text-ink-2">{shortDate(p.date)}</div>
            </div>
          );
        })}
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className="text-[11px] font-semibold text-ink-2">→ Handoff</div>
          <div className="h-[10px] w-full rounded-t-[4px] border border-dashed border-border" />
          <div className="text-[11px] text-ink-2">{shortDate(listing.cutoff)}</div>
        </div>
      </div>
    </div>
  );
}

function SoldDialog({ listing }: { listing: Listing }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(listing.current_price));
  const sold = useAction(() => post(`/listings/${listing.id}/sold`, { price: Number(price) }), { success: "Marked sold — nice!", onSuccess: () => setOpen(false) });
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger asChild><Button size="sm" variant="secondary">Mark sold</Button></D.Trigger>
      <DialogContent title="Mark as sold" description="The buyer pays you in person at pickup. Handoff never processes item payments.">
        <Field label="Sold for ($)"><Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <div className="mt-5 flex justify-end"><Button onClick={() => sold.mutate()} loading={sold.isPending}>Save</Button></div>
      </DialogContent>
    </D.Root>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  const url = `${window.location.origin}/l/${listing.public_slug}`;
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Couldn't copy — select the text manually.");
    }
  };
  const listingText = `${listing.title}\n\n${listing.description}\n\nPhotos & pickup times: ${url}`;
  const newRequests = listing.interest_requests.filter((r) => r.status === "new").length;
  return (
    <Card className="overflow-hidden">
      <div className="grid sm:grid-cols-[220px_1fr]">
        <div className="relative aspect-[4/3] bg-surface-2 sm:aspect-auto">
          {listing.item?.photos?.[0] && <img src={assetUrl(listing.item.photos[0])} alt={listing.item.name} className="h-full w-full object-cover" />}
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-display text-[17px] font-semibold">{listing.title}</h3>
              <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{listing.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {newRequests > 0 && <Badge tone="orange">{newRequests} request{newRequests > 1 ? "s" : ""}</Badge>}
              <Badge tone={listing.status === "active" ? "success" : listing.status === "sold" ? "dark" : "neutral"}>
                {listing.status === "draft" ? "Waiting for your OK" : listing.status === "sold" ? `Sold ${money(listing.sold_price)}` : listing.status}
              </Badge>
            </div>
          </div>
          {listing.status !== "sold" && <PriceTimeline listing={listing} />}
          <div className="mt-4 flex flex-wrap gap-2">
            {listing.status === "active" && (
              <>
                <Button size="sm" variant="secondary" onClick={() => copy(listingText, "Listing copied — paste it into the marketplace")}><Copy /> Copy listing</Button>
                {listing.marketplaces.map((m) => (
                  <Button key={m.name} size="sm" variant="ghost" asChild>
                    <a href={m.url} target="_blank" rel="noreferrer"><ExternalLink /> {m.name.replace(" Marketplace", "")}</a>
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => copy(url, "Link copied")}><Link2 /> Share link</Button>
                <Button size="sm" variant="ghost" asChild><Link to={`/l/${listing.public_slug}`}>Preview page</Link></Button>
                <SoldDialog listing={listing} />
              </>
            )}
          </div>
          <EstimateNote className="mt-3">Handoff never posts for you — copy the listing and post it yourself. Buyers pay in person.</EstimateNote>
        </div>
      </div>
    </Card>
  );
}

export default function Listings() {
  const listings = useListings();
  const items = useItems();
  const create = useAction((id: string) => post(`/items/${id}/listing`, {}), { success: "Draft listing created" });
  if (listings.isError) return <ErrorState error={listings.error} onRetry={() => listings.refetch()} />;
  if (listings.isLoading) return <div className="space-y-3"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>;
  const listed = new Set((listings.data || []).map((l) => l.item_id));
  const toList = (items.data || []).filter((i) => i.decision === "SELL" && !listed.has(i.id));
  return (
    <div className="space-y-4">
      {toList.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-orange/40 bg-orange-tint/40 p-4">
          <div className="flex items-center gap-2 text-[14px]"><Tag className="size-4 text-orange-text" /> {toList.length} item{toList.length > 1 ? "s" : ""} marked Sell without a listing: {toList.map((i) => i.name).join(", ")}</div>
          <div className="flex gap-2">{toList.slice(0, 3).map((i) => <Button key={i.id} size="sm" onClick={() => create.mutate(i.id)} loading={create.isPending}>List {i.name}</Button>)}</div>
        </Card>
      )}
      {!listings.data?.length ? (
        <EmptyState title="No listings yet" body="Mark items Sell in the review deck, then ask Handoff for a plan — it prices them and builds a shareable page." />
      ) : (
        listings.data.map((l) => <ListingCard key={l.id} listing={l} />)
      )}
    </div>
  );
}
