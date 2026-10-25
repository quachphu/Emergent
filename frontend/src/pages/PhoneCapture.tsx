import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Camera, Check, ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { api, upload } from "@/lib/api";
import type { Room } from "@/lib/types";

export default function PhoneCapture() {
  const { token = "" } = useParams();
  const info = useQuery({ queryKey: ["capture", token], queryFn: () => api<{ first_name: string; room_id?: string; rooms: Room[] }>(`/public/capture/${token}`), retry: false });
  const [room, setRoom] = useState<string>("");
  const [hint, setHint] = useState("");
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const roomId = room || info.data?.room_id || info.data?.rooms?.[0]?.id || "";

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    form.append("room_id", roomId);
    form.append("hint", hint);
    try {
      const r = await upload<{ received: number }>(`/public/capture/${token}`, form);
      setSent((n) => n + r.received);
      setHint("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (info.isError)
    return (
      <div className="grid min-h-screen place-items-center bg-bg p-6 text-center">
        <div><h1 className="text-2xl font-bold">Link expired</h1><p className="mt-2 text-ink-2">{(info.error as Error).message}</p></div>
      </div>
    );

  return (
    <div className="min-h-screen bg-hero text-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col p-5">
        <div className="flex items-center gap-2.5 pt-2">
          <span className="grid size-8 place-items-center rounded-[9px] bg-orange"><svg viewBox="0 0 24 24" className="size-[18px]"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#1F1E1B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span className="font-display text-[17px] font-bold">Handoff</span>
        </div>
        <h1 className="mt-10 text-[30px] font-bold leading-tight">{info.data ? `Hi ${info.data.first_name}! Snap your stuff.` : "Loading…"}</h1>
        <p className="mt-2 text-white/65">Photos appear on your computer right away. One item per photo works best.</p>
        <div className="mt-8 space-y-3">
          <label className="block text-[13px] text-white/70">Room
            <Select value={roomId} onChange={(e) => setRoom(e.target.value)} className="mt-1.5 border-white/15 bg-white/10 text-white">
              {(info.data?.rooms || []).map((r) => <option key={r.id} value={r.id} className="text-ink">{r.name}</option>)}
            </Select>
          </label>
          <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="What is it? (optional)" className="border-white/15 bg-white/10 text-white placeholder:text-white/40" />
        </div>
        <div className="mt-auto space-y-3 pb-6 pt-10">
          {sent > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-card bg-success/20 px-4 py-3 text-[15px]">
              <Check className="size-5 text-[#4DB38A]" /> {sent} photo{sent > 1 ? "s" : ""} sent to your computer
            </motion.div>
          )}
          {error && <p className="rounded-card bg-danger/20 px-4 py-3 text-[14px]">{error}</p>}
          <Button size="lg" className="h-16 w-full text-[17px]" onClick={() => input.current?.click()} loading={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Camera />} Take a photo
          </Button>
          <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-ctl text-[15px] text-white/75 ring-1 ring-white/15">
            <ImagePlus className="size-4" /> Choose from library
            <input type="file" accept="image/*" multiple hidden onChange={(e) => send(e.target.files)} />
          </label>
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => send(e.target.files)} />
        </div>
      </div>
    </div>
  );
}
