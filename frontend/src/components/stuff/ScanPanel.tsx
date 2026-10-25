import * as D from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Camera, ImagePlus, Loader2, Plus, QrCode, Smartphone, Sparkles, Upload } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, assetUrl, post, upload } from "@/lib/api";
import { useInvalidateAll, useRooms, useSteps } from "@/lib/queries";
import type { Room } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SensitiveNotice } from "../common";
import { PulseDot } from "../motion";

type Media = { id: string; file: string; name: string; analyzed: boolean; room_id?: string; source: string; created_at: string };

function RoomPicker({ rooms, value, onChange }: { rooms: Room[]; value: string; onChange: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const invalidate = useInvalidateAll();
  const add = async () => {
    if (!name.trim()) return;
    try {
      const r = await post<Room>("/rooms", { name });
      invalidate();
      onChange(r.id);
      setName("");
      setAdding(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Room">
      {rooms.map((r) => (
        <button key={r.id} role="radio" aria-checked={value === r.id} onClick={() => onChange(r.id)}
          className={cn("h-9 rounded-full border px-4 text-[14px] font-medium transition-all", value === r.id ? "border-orange bg-orange-tint text-ink" : "border-border bg-surface hover:bg-surface-2")}>
          {r.name}
        </button>
      ))}
      {adding ? (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-1.5">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name" className="h-9 w-36" />
          <Button size="sm" type="submit">Add</Button>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="flex h-9 items-center gap-1 rounded-full border border-dashed border-border px-3 text-[14px] text-ink-2 hover:text-ink"><Plus className="size-4" /> Room</button>
      )}
    </div>
  );
}

function WebcamDialog({ open, onOpenChange, onCapture }: { open: boolean; onOpenChange: (o: boolean) => void; onCapture: (f: File, hint: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    setError(null);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
        if (video.current) video.current.srcObject = stream;
      } catch {
        setError("Camera unavailable. Allow camera access in your browser, or upload photos instead.");
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [open]);
  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      onCapture(new File([b], `${hint || "webcam"}-${Date.now()}.jpg`, { type: "image/jpeg" }), hint);
      setCount((n) => n + 1);
      setHint("");
    }, "image/jpeg", 0.88);
  };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Capture with your webcam" description="Point the camera at one item at a time." wide>
        {error ? (
          <p className="rounded-ctl bg-warning/10 p-4 text-[14px] text-warning">{error}</p>
        ) : (
          <div className="overflow-hidden rounded-card bg-black"><video ref={video} autoPlay playsInline muted className="aspect-video w-full object-cover" /></div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="What is it? (optional, helps the AI)" className="min-w-[200px] flex-1" />
          <Button onClick={snap} disabled={!!error}><Camera /> Capture</Button>
        </div>
        {count > 0 && <p className="mt-2 text-[13px] text-success">{count} captured — identifying in the background.</p>}
      </DialogContent>
    </D.Root>
  );
}

function PhoneDialog({ open, onOpenChange, roomId }: { open: boolean; onOpenChange: (o: boolean) => void; roomId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setUrl(null);
    post<{ path: string }>("/scan/capture-link", { room_id: roomId || null })
      .then((r) => setUrl(`${window.location.origin}${r.path}`))
      .catch((e) => toast.error(e.message));
  }, [open, roomId]);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Use your phone" description="Scan the code with your phone's camera. Photos you take appear here in real time.">
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-card border border-border bg-white p-4 shadow-card">
            {url ? <QRCodeSVG value={url} size={208} level="M" fgColor="#1F1E1B" /> : <div className="grid size-[208px] place-items-center"><Loader2 className="animate-spin text-ink-2" /></div>}
          </div>
          {url && <a href={url} target="_blank" rel="noreferrer" className="max-w-full truncate text-[13px] text-orange-text hover:underline">{url}</a>}
          <p className="flex items-center gap-2 text-[13px] text-ink-2"><PulseDot tone="success" /> Waiting for photos… The link works for 2 hours.</p>
        </div>
      </DialogContent>
    </D.Root>
  );
}

export function ScanPanel() {
  const rooms = useRooms();
  const steps = useSteps({ lane: "stuff" });
  const invalidate = useInvalidateAll();
  const media = useQuery({ queryKey: ["scan_media"], queryFn: () => api<Media[]>("/scan/media") });
  const [roomId, setRoomId] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [cam, setCam] = useState(false);
  const [phone, setPhone] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!roomId && rooms.data?.length) setRoomId(rooms.data[0].id);
  }, [rooms.data, roomId]);

  const send = useCallback(
    async (files: File[], h = hint, source = "upload") => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) {
        toast.error("Those don't look like photos. Use JPG, PNG or HEIC.");
        return;
      }
      setBusy(true);
      const form = new FormData();
      imgs.forEach((f) => form.append("files", f));
      form.append("room_id", roomId);
      form.append("hint", h);
      form.append("source", source);
      try {
        await upload("/scan/upload", form);
        toast.success(`${imgs.length} photo${imgs.length > 1 ? "s" : ""} uploaded`, { description: "Handoff is identifying items…" });
        invalidate();
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setBusy(false);
      }
    },
    [hint, roomId, invalidate],
  );

  const samples = async () => {
    const names = ["dining-chair.jpg", "dining-table.jpg"];
    const files = await Promise.all(names.map(async (n) => new File([await (await fetch(`/samples/${n}`)).blob()], n, { type: "image/jpeg" })));
    send(files, "", "upload");
  };

  const running = (steps.data || []).some((s) => s.state === "running" && s.agent === "vision");
  const recent = (media.data || []).slice(0, 12);
  const roomName = rooms.data?.find((r) => r.id === roomId)?.name;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-3 text-[13px] font-medium text-ink-2">Which room?</div>
        <RoomPicker rooms={rooms.data || []} value={roomId} onChange={setRoomId} />
      </Card>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); send(Array.from(e.dataTransfer.files)); }}
        className={cn("relative overflow-hidden rounded-[20px] border-2 border-dashed p-8 text-center transition-all sm:p-12", drag ? "border-orange bg-orange-tint" : "border-border bg-surface")}
        data-testid="dropzone"
      >
        <motion.div animate={drag ? { scale: 1.05 } : { scale: 1 }} className="mx-auto grid size-16 place-items-center rounded-[18px] bg-orange-tint text-orange-text">
          {busy || running ? <Loader2 className="size-7 animate-spin" /> : <ImagePlus className="size-7" />}
        </motion.div>
        <h3 className="mt-4 font-display text-[20px] font-semibold">{running ? "Identifying items…" : `Drop photos of the ${roomName?.toLowerCase() || "room"}`}</h3>
        <p className="mx-auto mt-1 max-w-md text-[14px] text-ink-2">One item per photo works best. Handoff names each item, rates condition and estimates value ranges.</p>
        <div className="mx-auto mt-5 max-w-sm"><Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Optional hint, e.g. “IKEA desk, barely used”" aria-label="Hint for these photos" /></div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={() => fileInput.current?.click()} loading={busy}><Upload /> Choose photos</Button>
          <Button variant="secondary" onClick={() => setCam(true)}><Camera /> Webcam</Button>
          <Button variant="secondary" onClick={() => setPhone(true)}><Smartphone /> Use your phone</Button>
          <Button variant="ghost" onClick={samples} disabled={busy} data-testid="sample-photos"><Sparkles /> Try sample photos</Button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { send(Array.from(e.target.files || [])); e.target.value = ""; }} data-testid="file-input" />
      </div>

      <SensitiveNotice text="Photos stay private to you. Avoid capturing IDs, mail with account numbers or screens with passwords. Raw scan photos are deleted 7 days after you confirm your inventory." />

      {recent.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium"><QrCode className="size-4 text-ink-2" /> Recent photos</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {recent.map((m) => (
              <div key={m.id} className="relative aspect-square overflow-hidden rounded-ctl bg-surface-2">
                <img src={assetUrl(m.file)} alt={m.name} className="h-full w-full object-cover" />
                <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between">
                  {m.source === "phone" && <Badge tone="dark" className="h-5 text-[10px]">Phone</Badge>}
                  <Badge tone={m.analyzed ? "success" : "orange"} className="ml-auto h-5 text-[10px]">{m.analyzed ? "Done" : "Reading"}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <WebcamDialog open={cam} onOpenChange={setCam} onCapture={(f, h) => send([f], h, "webcam")} />
      <PhoneDialog open={phone} onOpenChange={setPhone} roomId={roomId} />
    </div>
  );
}
