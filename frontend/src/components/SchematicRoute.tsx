import { cn } from "@/lib/utils";

/** Schematic route drawing used while maps load or when no map tiles are reachable. */
export function SchematicRoute({ fromLabel, toLabel, className }: { fromLabel?: string; toLabel?: string; className?: string }) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-hero", className)} aria-hidden>
      <div className="bg-grid absolute inset-0" />
      <svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF6600" stopOpacity=".35" />
            <stop offset="100%" stopColor="#FF6600" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d="M120 420 C 260 180, 470 120, 640 90" fill="none" stroke="#FF6600" strokeOpacity=".25" strokeWidth="14" strokeLinecap="round" />
        <path d="M120 420 C 260 180, 470 120, 640 90" fill="none" stroke="#FF6600" strokeWidth="3.5" strokeDasharray="10 10" strokeLinecap="round">
          <animate attributeName="stroke-dashoffset" from="200" to="0" dur="4s" repeatCount="indefinite" />
        </path>
        <circle cx="120" cy="420" r="60" fill="url(#glow)" />
        <circle cx="640" cy="90" r="70" fill="url(#glow)" />
        <circle cx="120" cy="420" r="9" fill="#fff" stroke="#FF6600" strokeWidth="4" />
        <circle cx="640" cy="90" r="11" fill="#FF6600" stroke="#fff" strokeWidth="4" />
        {fromLabel && <text x="140" y="445" fill="#fff" fillOpacity=".75" fontSize="18" fontFamily="Inter Variable, sans-serif">{fromLabel}</text>}
        {toLabel && <text x="625" y="135" textAnchor="end" fill="#fff" fillOpacity=".9" fontSize="18" fontWeight="600" fontFamily="Inter Variable, sans-serif">{toLabel}</text>}
      </svg>
    </div>
  );
}
