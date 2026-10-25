import animate from "tailwindcss-animate";
/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"),
        surface: c("surface"),
        "surface-2": c("surface-2"),
        ink: c("ink"),
        "ink-2": c("ink-2"),
        border: c("border"),
        orange: { DEFAULT: c("orange"), text: c("orange-text"), tint: c("orange-tint") },
        hero: c("hero"),
        success: c("success"),
        warning: c("warning"),
        danger: c("danger"),
      },
      fontFamily: {
        display: ['"Inter Tight Variable"', '"Inter Variable"', "system-ui", "sans-serif"],
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "monospace"],
      },
      opacity: { 8: ".08", 12: ".12", 15: ".15", 35: ".35", 85: ".85" },
      borderRadius: { card: "12px", ctl: "8px" },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)",
        lift: "0 2px 4px rgba(0,0,0,.05), 0 16px 40px rgba(0,0,0,.10)",
        glow: "0 0 0 4px rgb(var(--orange) / .18)",
      },
      keyframes: {
        pulsedot: { "0%,100%": { transform: "scale(1)", opacity: "1" }, "50%": { transform: "scale(1.6)", opacity: ".35" } },
        shimmer: { "0%": { backgroundPosition: "-400px 0" }, "100%": { backgroundPosition: "400px 0" } },
      },
      animation: { pulsedot: "pulsedot 1.4s ease-in-out infinite", shimmer: "shimmer 1.4s linear infinite" },
    },
  },
  plugins: [animate],
};
