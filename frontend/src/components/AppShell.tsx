import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Inbox,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Monitor,
  Moon,
  Search,
  Settings,
  Shield,
  Sun,
  Zap,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import * as Dm from "@radix-ui/react-dropdown-menu";
import * as D from "@radix-ui/react-dialog";
import { Kbd } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { LANES } from "@/lib/format";
import { useLiveStream } from "@/lib/live";
import { useItems, useSummary, useTasks } from "@/lib/queries";
import { applyTheme, getTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { PulseDot } from "./motion";
import { PanelProvider, usePanel } from "./SidePanel";

const NAV_TOP = [{ to: "/", label: "Command Center", icon: LayoutDashboard, end: true }];
const NAV_BOTTOM = [
  { to: "/run", label: "Agent runs", icon: Bot },
  { to: "/map", label: "Map", icon: MapIcon },
  { to: "/vault", label: "Vault", icon: Shield },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Logo({ dark }: { dark?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-ctl" aria-label="Handoff home">
      <span className="grid size-8 place-items-center rounded-[9px] bg-orange shadow-[inset_0_1px_0_rgba(255,255,255,.3)]">
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#1F1E1B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className={cn("font-display text-[17px] font-bold tracking-tight", dark ? "text-white" : "text-ink")}>Handoff</span>
    </Link>
  );
}

function NavItem({ to, label, icon: Icon, emoji, end, badge }: { to: string; label: string; icon?: any; emoji?: string; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex h-9 items-center gap-2.5 rounded-ctl px-2.5 text-[14px] font-medium transition-colors",
          isActive ? "bg-surface text-ink shadow-sm ring-1 ring-border" : "text-ink-2 hover:bg-surface/70 hover:text-ink",
        )
      }
    >
      {emoji ? <span className="w-[18px] text-center text-[15px]" aria-hidden>{emoji}</span> : <Icon className="size-[18px]" />}
      <span className="flex-1 truncate">{label}</span>
      {!!badge && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-orange px-1.5 text-[11px] font-bold text-[#1F1E1B]">{badge}</span>}
    </NavLink>
  );
}

function Sidebar({ inbox, lanes }: { inbox: number; lanes: Record<string, number> }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border bg-surface-2 px-3 py-4 lg:flex">
      <div className="px-2"><Logo /></div>
      <nav className="mt-6 flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Main">
        {NAV_TOP.map((n) => <NavItem key={n.to} {...n} />)}
        <div className="mb-1 mt-5 px-2.5 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-2">Lanes</div>
        {LANES.map((l) => <NavItem key={l.lane} to={l.path} label={l.label} emoji={l.emoji} badge={lanes[l.lane]} />)}
        <div className="mb-1 mt-5 px-2.5 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-2">Workspace</div>
        {NAV_BOTTOM.map((n) => <NavItem key={n.to} {...n} badge={n.to === "/inbox" ? inbox : undefined} />)}
      </nav>
      <div className="mt-3 rounded-card bg-hero p-3.5 text-white">
        <div className="flex items-center gap-2 text-[12px] font-semibold"><Zap className="size-3.5 text-orange" /> Approval gate on</div>
        <p className="mt-1 text-[12px] leading-snug text-white/60">Nothing is sent, booked or paid without your OK.</p>
      </div>
    </aside>
  );
}

function ThemeMenu() {
  const [theme, setTheme] = useState<Theme>(getTheme());
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <Dm.Root>
      <Dm.Trigger className="grid size-9 place-items-center rounded-ctl text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Theme">
        <Icon className="size-[18px]" />
      </Dm.Trigger>
      <Dm.Portal>
        <Dm.Content align="end" sideOffset={6} className="z-50 min-w-[150px] rounded-card border border-border bg-surface p-1 shadow-lift">
          {(["light", "dark", "system"] as Theme[]).map((t) => (
            <Dm.Item key={t} onSelect={() => { applyTheme(t); setTheme(t); }} className={cn("flex cursor-pointer items-center gap-2 rounded-ctl px-2.5 py-2 text-[14px] capitalize outline-none data-[highlighted]:bg-surface-2", theme === t && "text-orange-text")}>
              {t === "light" ? <Sun className="size-4" /> : t === "dark" ? <Moon className="size-4" /> : <Monitor className="size-4" />} {t}
            </Dm.Item>
          ))}
        </Dm.Content>
      </Dm.Portal>
    </Dm.Root>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const initials = (user?.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <Dm.Root>
      <Dm.Trigger className="grid size-9 place-items-center rounded-full bg-ink text-[13px] font-semibold text-bg" aria-label="Account">{initials}</Dm.Trigger>
      <Dm.Portal>
        <Dm.Content align="end" sideOffset={6} className="z-50 min-w-[200px] rounded-card border border-border bg-surface p-1 shadow-lift">
          <div className="px-2.5 py-2"><div className="text-[14px] font-medium">{user?.name}</div><div className="text-[12px] text-ink-2">{user?.email}</div></div>
          <Dm.Separator className="my-1 h-px bg-border" />
          <Dm.Item onSelect={() => navigate("/settings")} className="flex cursor-pointer items-center gap-2 rounded-ctl px-2.5 py-2 text-[14px] outline-none data-[highlighted]:bg-surface-2"><Settings className="size-4" /> Settings</Dm.Item>
          <Dm.Item onSelect={() => { signOut(); navigate("/login"); }} className="flex cursor-pointer items-center gap-2 rounded-ctl px-2.5 py-2 text-[14px] outline-none data-[highlighted]:bg-surface-2"><LogOut className="size-4" /> Sign out</Dm.Item>
        </Dm.Content>
      </Dm.Portal>
    </Dm.Root>
  );
}

function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const navigate = useNavigate();
  const items = useItems();
  const tasks = useTasks();
  const panel = usePanel();
  const go = (fn: () => void) => { setOpen(false); fn(); };
  const pages = [
    { label: "Command Center", to: "/" },
    ...LANES.map((l) => ({ label: `${l.emoji} ${l.label}`, to: l.path })),
    { label: "📷 Scan a room", to: "/stuff?tab=scan" },
    { label: "👆 Review deck", to: "/stuff?tab=review" },
    { label: "🤝 Handoff board", to: "/stuff?tab=handoff" },
    { label: "🤖 Agent runs", to: "/run" },
    { label: "🗺️ Map", to: "/map" },
    { label: "🔒 Vault", to: "/vault" },
    { label: "📥 Inbox", to: "/inbox" },
    { label: "⚙️ Settings", to: "/settings" },
  ];
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border border-border bg-surface shadow-lift">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search pages, items and tasks</D.Description>
          <Command label="Command palette" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-ink-2">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-ink-2" />
              <Command.Input autoFocus placeholder="Search pages, items, tasks…" className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-2" />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-sm text-ink-2">No results.</Command.Empty>
              <Command.Group heading="Actions">
                <PaletteItem onSelect={() => go(() => navigate("/run?propose=1"))}>🤖 Ask Handoff for a plan</PaletteItem>
                <PaletteItem onSelect={() => go(() => navigate("/stuff?tab=scan"))}>📷 Scan photos</PaletteItem>
              </Command.Group>
              <Command.Group heading="Go to">
                {pages.map((p) => <PaletteItem key={p.to} onSelect={() => go(() => navigate(p.to))}>{p.label}</PaletteItem>)}
              </Command.Group>
              {!!items.data?.length && (
                <Command.Group heading="Items">
                  {items.data.map((i) => <PaletteItem key={i.id} value={`item ${i.name}`} onSelect={() => go(() => panel.open({ type: "item", id: i.id }))}>📦 {i.name}</PaletteItem>)}
                </Command.Group>
              )}
              {!!tasks.data?.length && (
                <Command.Group heading="Tasks">
                  {tasks.data.slice(0, 40).map((t) => <PaletteItem key={t.id} value={`task ${t.title}`} onSelect={() => go(() => panel.open({ type: "task", id: t.id }))}>✓ {t.title}</PaletteItem>)}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function PaletteItem({ children, onSelect, value }: { children: ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex cursor-pointer items-center gap-2 rounded-ctl px-3 py-2.5 text-[14px] data-[selected=true]:bg-orange-tint data-[selected=true]:text-ink">
      {children}
    </Command.Item>
  );
}

function TopBar({ onSearch, live }: { onSearch: () => void; live: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6">
      <div className="lg:hidden"><Logo /></div>
      <button onClick={onSearch} className="ml-auto flex h-9 w-9 items-center gap-2 rounded-ctl border border-border bg-surface px-3 text-[14px] text-ink-2 shadow-sm transition-colors hover:text-ink sm:w-72 lg:ml-0" aria-label="Search (Command K)">
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 text-left sm:inline">Search or jump to…</span>
        <span className="hidden gap-0.5 sm:flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
      </button>
      <div className="flex items-center gap-1 lg:ml-auto">
        <span className="mr-2 hidden items-center gap-2 text-[12px] text-ink-2 md:flex" title={live === "live" ? "Live updates connected" : "Reconnecting — updates every few seconds"}>
          {live === "live" ? <PulseDot tone="success" /> : <span className="size-2.5 rounded-full bg-warning" />}
          {live === "live" ? "Live" : "Syncing"}
        </span>
        <ThemeMenu />
        <UserMenu />
      </div>
    </header>
  );
}

function MobileTabBar({ inbox }: { inbox: number }) {
  const tabs = [
    { to: "/", label: "Home", icon: LayoutDashboard, end: true },
    { to: "/stuff", label: "Stuff", emoji: "📦" },
    { to: "/transport", label: "Move", emoji: "🚚" },
    { to: "/run", label: "Agent", icon: Bot },
    { to: "/inbox", label: "Inbox", icon: Inbox, badge: inbox },
  ];
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur-md lg:hidden" aria-label="Main">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", isActive ? "text-orange-text" : "text-ink-2")}>
          {t.emoji ? <span className="text-[19px] leading-none" aria-hidden>{t.emoji}</span> : t.icon ? <t.icon className="size-5" /> : null}
          {t.label}
          {!!t.badge && <span className="absolute right-[calc(50%-20px)] top-2 grid h-4 min-w-4 place-items-center rounded-full bg-orange px-1 text-[10px] font-bold text-[#1F1E1B]">{t.badge}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const live = useLiveStream(true);
  const summary = useSummary();
  const location = useLocation();
  const inbox = summary.data?.inbox_count ?? 0;
  const lanes = Object.fromEntries((summary.data?.lanes || []).map((l) => [l.lane, l.waiting]));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="flex min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-ctl focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <Sidebar inbox={inbox} lanes={lanes} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onSearch={() => setPaletteOpen(true)} live={live} />
        <main id="main" className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <MobileTabBar inbox={inbox} />
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PanelProvider>
      <ShellInner>{children}</ShellInner>
    </PanelProvider>
  );
}
