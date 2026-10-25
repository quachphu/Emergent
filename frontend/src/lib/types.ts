export type Lane = "stuff" | "transport" | "old_home" | "new_home" | "admin";
export type Decision = "KEEP" | "SELL" | "HANDOFF" | "DONATE" | "RECYCLE" | "CITY_PICKUP" | "HAUL";
export type TaskStatus = "todo" | "in_progress" | "waiting_for_user" | "done" | "skipped";
export type StepState = "planned" | "running" | "waiting_for_user" | "done" | "failed";

export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Move {
  id: string;
  move_date: string;
  from_address: string;
  to_address: string;
  work_address?: string;
  from_geo?: GeoPoint;
  to_geo?: GeoPoint;
  work_geo?: GeoPoint;
  from_city?: string;
  to_city?: string;
  from_area?: string;
  to_area?: string;
  home_size: string;
  move_method: "movers" | "diy_truck" | "shipping" | "suitcases";
  priorities: { cash: number; speed: number; landfill: number };
  relocation_budget: number;
  notice_period_days?: number;
  onboarded?: boolean;
  demo?: boolean;
  car?: Car;
  landlord_name?: string;
}

export interface Car {
  make: string;
  model: string;
  year: number;
  mileage?: number | null;
  value_low: number;
  value_high: number;
  path?: "sell" | "ship" | null;
  source?: string;
}

export interface Item {
  id: string;
  room_id?: string;
  photos: string[];
  name: string;
  category: string;
  brand_guess?: string | null;
  condition: number;
  size: "S" | "M" | "L" | "XL";
  dims_estimate?: string;
  resale_low: number;
  resale_high: number;
  move_cost_estimate: number;
  replacement_cost_estimate: number;
  weight_lbs?: number;
  decision?: Decision | null;
  decision_reason?: string | null;
  suggestion?: { decision: Decision; reason: string } | null;
  status: string;
  source?: string;
  confidence?: number;
  sold_price?: number;
  listing_id?: string;
  pickup_date?: string;
  handoff_window?: string;
  created_at?: string;
}

export interface Task {
  id: string;
  key: string;
  lane: Lane;
  title: string;
  due_date: string;
  clock: string;
  status: TaskStatus;
  notes?: string;
  tight?: boolean;
  related_item_ids?: string[];
}

export interface Receipt {
  kind: string;
  text: string;
  amount?: number;
  url?: string | null;
  image?: string | null;
  meta?: Record<string, any>;
}

export interface Step {
  id: string;
  lane: Lane;
  task_id?: string | null;
  run_id?: string | null;
  agent?: string;
  title: string;
  state: StepState;
  reason?: string;
  receipt?: Receipt | null;
  gate?: {
    kind: string;
    handler: string;
    preview?: string;
    cta?: string;
    approved?: boolean;
    payload?: Record<string, any>;
  } | null;
  undo?: { handler: string; label?: string } | null;
  undone?: boolean;
  declined?: boolean;
  link?: string;
  cta?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface RunAction {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  params: Record<string, any>;
  enabled: boolean;
  status: string;
}

export interface Run {
  id: string;
  status: "proposed" | "running" | "paused" | "done";
  actions: RunAction[];
  created_at: string;
}

export interface LaneSummary {
  lane: Lane;
  emoji: string;
  label: string;
  total: number;
  done: number;
  progress: number;
  waiting: number;
  next: Task | null;
}

export interface Money {
  earned: number;
  potential_low: number;
  potential_high: number;
  saved: number;
  spent: number;
  budget: number;
  budget_left: number;
  label: string;
}

export interface Summary {
  move: Move;
  days_left: number;
  distance_miles: number | null;
  commute_minutes: number | null;
  lanes: LaneSummary[];
  today: Task[];
  inbox_count: number;
  money: Money;
  impact: { items_rehomed: number; money_earned: number; pounds_diverted: number; label: string };
  resolved_pct: number;
  counts: { items: number; tasks: number; tasks_done: number; items_resolved: number };
}

export interface Quote {
  id: string;
  job_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_rating?: number;
  price?: number | null;
  eta?: string | null;
  notes?: string | null;
  message_text: string;
  response_minutes?: number;
  status: "open" | "declined" | "booked" | "not_selected";
  parsed_by?: string;
}

export interface Job {
  id: string;
  type: "haul" | "mover" | "auto_transport";
  status: "draft" | "sent" | "booked";
  package: {
    item_list: { id: string; name: string; size: string; dims?: string }[];
    volume: number;
    floor: number;
    elevator: boolean;
    time_window: string;
    from_address?: string;
    to_address?: string;
  };
  quotes: Quote[];
  booking?: Booking | null;
}

export interface Booking {
  id: string;
  status: "pending" | "paid";
  amount: number;
  receipt_url?: string | null;
  simulated?: boolean;
  checkout_url?: string;
  quote?: Quote;
  vendor?: Vendor;
}

export interface Vendor {
  id: string;
  name: string;
  type: string;
  rating: number;
  phone: string;
  service_area: string[];
  location?: GeoPoint;
}

export interface Need {
  id: string;
  arrival_name: string;
  city: string;
  neighborhood?: string;
  item_wanted: string;
  details: string;
  needed_by?: string;
  status: string;
  location?: GeoPoint;
}

export interface Match {
  id: string;
  item_id: string;
  need_id: string;
  score: number;
  status: "suggested" | "offered" | "accepted" | "declined";
  pickup_window?: string | null;
  pickup_windows?: string[];
  item: Item;
  need: Need;
}

export interface Listing {
  id: string;
  item_id: string;
  title: string;
  description: string;
  price_schedule: { date: string; price: number; note: string }[];
  cutoff: string;
  current_price: number;
  public_slug: string;
  status: "draft" | "active" | "sold" | "expired";
  sold_price?: number;
  interest_requests: { id: string; name: string; contact: string; proposed_time: string; message?: string; status: string }[];
  item: Item;
  schedule_text: string;
  marketplaces: { name: string; url: string }[];
}

export interface Doc {
  id: string;
  type: string;
  kind?: string;
  title: string;
  file?: string | null;
  summary?: any;
  flags?: { clause: string; category: string; severity: "low" | "medium" | "high"; explanation: string }[];
  extracted_text?: string;
  expires_at?: string | null;
  days_to_expiry?: number;
  amount?: number;
  url?: string | null;
  created_at: string;
}

export interface Room {
  id: string;
  name: string;
}

export interface Config {
  demo_mode: boolean;
  mapbox_token: string | null;
  stripe_publishable_key: string | null;
  integrations: Record<string, { provider: string; live: boolean; model?: string | null; mode?: string }>;
}
