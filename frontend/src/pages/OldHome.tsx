import { useQuery } from "@tanstack/react-query";
import { Camera, Check, Copy, FileSignature, Printer, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, SectionTitle } from "@/components/common";
import { LanePlan } from "@/components/LanePlan";
import { LaneSteps } from "@/components/LaneSteps";
import { CountUp, ProgressRing } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, assetUrl, patch, post, upload } from "@/lib/api";
import { laneMeta, longDate } from "@/lib/format";
import { useAction, useInvalidateAll, useTasks } from "@/lib/queries";
import type { Doc, Room } from "@/lib/types";

type OldHomeData = {
  notice: { notice_period_days: number; ideal_send_date: string; late: boolean; short_by_days: number; message: string };
  letter: Doc | null;
  rooms: Room[];
  photos: (Doc & { room_id: string; taken_at: string })[];
  deposit: { move_out: string; due: string; days_until_due: number; days: number; letter: { subject: string; body: string } };
  landlord_name?: string;
  notice_sent: boolean;
};

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy — select the text manually.");
  }
}

function printLetter(title: string, body: string) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  w.document.write(`<html><head><title>${title}</title><style>body{font:15px/1.6 Georgia,serif;max-width:620px;margin:48px auto;white-space:pre-wrap;color:#1F1E1B}</style></head><body>${body.replace(/</g, "&lt;")}</body></html>`);
  w.document.close();
  w.print();
}

function RoomPhoto({ room, photos }: { room: Room; photos: OldHomeData["photos"] }) {
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const mine = photos.filter((p) => p.room_id === room.id);
  const send = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", f);
    form.append("room_id", room.id);
    try {
      await upload("/old-home/photos", form);
      invalidate();
      toast.success(`${room.name} photo saved with a timestamp`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-ctl border border-border p-3">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full ${mine.length ? "bg-success text-white" : "bg-surface-2 text-ink-2"}`}>{mine.length ? <Check className="size-4" /> : <Camera className="size-3.5" />}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{room.name}</div>
        <div className="text-[12px] text-ink-2">{mine.length ? `${mine.length} photo${mine.length > 1 ? "s" : ""} · last ${new Date(mine[mine.length - 1].taken_at).toLocaleString()}` : "Floors, walls, appliances, closets"}</div>
      </div>
      <div className="flex -space-x-2">{mine.slice(-3).map((p) => <img key={p.id} src={assetUrl(p.file)} alt="" className="size-9 rounded-[6px] border-2 border-surface object-cover" />)}</div>
      <label className="cursor-pointer">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">{busy ? "Saving…" : "Add photo"}</span>
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => send(e.target.files?.[0])} />
      </label>
    </div>
  );
}

export default function OldHome() {
  const meta = laneMeta("old_home");
  const q = useQuery({ queryKey: ["old-home"], queryFn: () => api<OldHomeData>("/old-home") });
  const tasks = useTasks("old_home");
  const [landlord, setLandlord] = useState<string | null>(null);
  const draft = useAction(() => post("/old-home/notice", landlord ? { landlord_name: landlord } : {}), { success: "Letter drafted — sign it yourself before sending" });
  const noticeTask = tasks.data?.find((t) => t.key === "notice_to_vacate");
  const sent = useAction(() => patch(`/tasks/${noticeTask!.id}`, { status: "done" }), { success: "Marked sent" });
  const d = q.data;
  return (
    <div className="space-y-8">
      <PageHeader emoji={meta.emoji} title="Old home" subtitle="Notice to vacate, move-out photos, keys and getting your deposit back." />
      {!d ? <Skeleton className="h-80" /> : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-5">
            <SectionTitle action={d.notice.late ? <Badge tone="danger">Short notice</Badge> : <Badge tone="success">On time</Badge>}>Notice to vacate</SectionTitle>
            <p className="text-[14px] text-ink-2">{d.notice.message}</p>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1"><Field label="Landlord or property manager"><Input value={landlord ?? d.landlord_name ?? ""} onChange={(e) => setLandlord(e.target.value)} placeholder="Name" /></Field></div>
              <Button onClick={() => draft.mutate()} loading={draft.isPending}><Sparkles /> {d.letter ? "Redraft" : "Draft letter"}</Button>
            </div>
            {d.letter && (
              <>
                <div className="mt-5 max-h-[420px] overflow-y-auto rounded-ctl border border-border bg-[#FFFDF8] p-6 font-serif text-[14.5px] leading-relaxed text-[#1F1E1B] shadow-inner dark:bg-[#F4F0E6]">
                  <pre className="whitespace-pre-wrap font-serif">{d.letter.extracted_text}</pre>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => copy(d.letter!.extracted_text || "")}><Copy /> Copy</Button>
                  <Button size="sm" variant="secondary" onClick={() => printLetter(d.letter!.title, d.letter!.extracted_text || "")}><Printer /> Print to sign</Button>
                  {!d.notice_sent && noticeTask && <Button size="sm" onClick={() => sent.mutate()} loading={sent.isPending}><FileSignature /> I signed and sent it</Button>}
                  {d.notice_sent && <Badge tone="success"><Check /> Signed & sent</Badge>}
                </div>
                <p className="mt-2 text-[12px] text-ink-2">Handoff never signs for you. Print or e-sign it yourself, then send it to your landlord.</p>
              </>
            )}
          </Card>
          <div className="space-y-6">
            <Card className="p-5">
              <SectionTitle>Deposit countdown</SectionTitle>
              <div className="flex items-center gap-5">
                <ProgressRing value={Math.max(0, 1 - Math.max(0, d.deposit.days_until_due) / (d.deposit.days + 14))} size={96} stroke={9}>
                  <div className="text-center"><div className="font-display text-[24px] font-bold tabular"><CountUp value={Math.max(0, d.deposit.days_until_due)} /></div><div className="text-[10px] text-ink-2">days</div></div>
                </ProgressRing>
                <div className="text-[14px]">
                  <div>Deposit due back by <b>{longDate(d.deposit.due)}</b></div>
                  <div className="mt-1 text-ink-2">California landlords have {d.deposit.days} days after move-out ({longDate(d.deposit.move_out)}) to return it with an itemized list.</div>
                </div>
              </div>
              <details className="mt-4 rounded-ctl border border-border p-3">
                <summary className="cursor-pointer text-[13px] font-medium">Follow-up letter (if it's late)</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-ink-2">{d.deposit.letter.body}</pre>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => copy(d.deposit.letter.body)}><Copy /> Copy</Button>
              </details>
            </Card>
            <Card className="p-5">
              <SectionTitle>Move-out photos</SectionTitle>
              <p className="mb-3 text-[13px] text-ink-2">Timestamped, room by room. Your best protection for the deposit.</p>
              <div className="space-y-2">{d.rooms.map((r) => <RoomPhoto key={r.id} room={r} photos={d.photos} />)}</div>
            </Card>
          </div>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"><LanePlan lane="old_home" /><LaneSteps lane="old_home" /></div>
    </div>
  );
}
