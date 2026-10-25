import type { Decision, Lane } from "./types";

export function money(n?: number | null, opts: { cents?: boolean } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.cents ? 2 : 0,
    minimumFractionDigits: opts.cents ? 2 : 0,
  });
}

export function range(lo?: number, hi?: number) {
  if (lo === undefined || hi === undefined) return "—";
  if (Math.round(lo) === Math.round(hi)) return money(lo);
  return `${money(lo)}–${money(hi).replace("$", "$")}`;
}

export function parseDay(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

export function daysFromToday(iso: string) {
  return Math.round((parseDay(iso).getTime() - today().getTime()) / 86400000);
}

export function shortDate(iso?: string | null) {
  if (!iso) return "";
  return parseDay(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function longDate(iso?: string | null) {
  if (!iso) return "";
  return parseDay(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function relDay(iso: string) {
  const d = daysFromToday(iso);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d < 0) return `${-d} days ago`;
  if (d < 7) return parseDay(iso).toLocaleDateString("en-US", { weekday: "short" });
  return shortDate(iso);
}

export function timeAgo(iso?: string) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const LANES: { lane: Lane; label: string; emoji: string; path: string; blurb: string }[] = [
  { lane: "stuff", label: "Stuff", emoji: "📦", path: "/stuff", blurb: "Scan, decide, sell, hand off" },
  { lane: "transport", label: "Transport", emoji: "🚚", path: "/transport", blurb: "Quotes, bookings, car" },
  { lane: "old_home", label: "Old home", emoji: "🔑", path: "/old-home", blurb: "Notice, photos, deposit" },
  { lane: "new_home", label: "New home", emoji: "🏠", path: "/new-home", blurb: "Lease, packet, utilities" },
  { lane: "admin", label: "Admin & money", emoji: "🗂️", path: "/admin", blurb: "Mail, DMV, bank, employer" },
];

export const laneMeta = (lane: Lane) => LANES.find((l) => l.lane === lane)!;

export const DECISION_META: Record<Decision, { label: string; tone: string; verb: string }> = {
  KEEP: { label: "Keep", tone: "bg-success/10 text-success", verb: "Keep" },
  SELL: { label: "Sell", tone: "bg-orange-tint text-orange-text", verb: "Sell" },
  HANDOFF: { label: "Hand off", tone: "bg-[#E8F0FF] text-[#2453B3] dark:bg-[#1B2740] dark:text-[#8DB0FF]", verb: "Hand off" },
  DONATE: { label: "Donate", tone: "bg-[#F3E8FF] text-[#7A3DB8] dark:bg-[#2B1D3A] dark:text-[#C9A2F5]", verb: "Donate" },
  RECYCLE: { label: "Recycle", tone: "bg-[#E6F6F1] text-[#1F7A62] dark:bg-[#15302A] dark:text-[#6FD3B5]", verb: "Recycle" },
  CITY_PICKUP: { label: "City pickup", tone: "bg-[#FFF6DB] text-[#8A6100] dark:bg-[#352B10] dark:text-[#F0C85A]", verb: "Free pickup" },
  HAUL: { label: "Haul away", tone: "bg-surface-2 text-ink-2", verb: "Haul" },
};

export const STATUS_LABEL: Record<string, string> = {
  new: "Needs review",
  decided: "Decided",
  listed: "Listed",
  offered: "Offered",
  handoff_scheduled: "Handoff set",
  handed_off: "Handed off",
  sold: "Sold",
  pickup_booked: "Pickup booked",
  haul_booked: "Haul booked",
  donation_planned: "Donation planned",
  packed: "Packing",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting_for_user: "Waiting for you",
  done: "Done",
  skipped: "Skipped",
};

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}
