import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString(), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span className={cn("tabular", className)}>{text}</motion.span>;
}

export function ProgressRing({ value, size = 56, stroke = 6, children, tone = "orange" }: { value: number; size?: number; stroke?: number; children?: ReactNode; tone?: "orange" | "success" }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(v * 100)}% done`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-surface-2" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          className={cn("fill-none", tone === "success" ? "stroke-success" : "stroke-orange")}
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - v) : c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: reduce ? 0 : 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function PulseDot({ className, tone = "orange" }: { className?: string; tone?: "orange" | "success" | "warning" }) {
  const color = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-orange";
  return (
    <span className={cn("relative inline-flex size-2.5", className)} aria-hidden>
      <span className={cn("absolute inset-0 animate-pulsedot rounded-full", color)} />
      <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
    </span>
  );
}

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>
      {children}
    </motion.div>
  );
}

export const staggerItem = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}
