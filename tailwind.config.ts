import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Deep analytical canvas — near-black with a cold blue undertone.
        ink: {
          900: "#07080C", // page background
          800: "#0B0D13", // app shell
          700: "#10131B", // raised surface
          600: "#161A24", // card
          500: "#1D222E", // card hover / inset
          400: "#272D3B", // borders strong
        },
        line: "rgba(255,255,255,0.07)",
        "line-strong": "rgba(255,255,255,0.12)",
        // X-Ray phosphor — the diagnostic glow.
        xray: {
          DEFAULT: "#5EEAD4",
          soft: "#2DD4BF",
          deep: "#0F766E",
          glow: "rgba(94,234,212,0.18)",
        },
        // Signal colours for diagnostics.
        signal: {
          good: "#4ADE80",
          warn: "#FBBF24",
          bad: "#F87171",
          info: "#60A5FA",
        },
        content: {
          DEFAULT: "#E8EAF0",
          muted: "#9AA1B2",
          faint: "#646B7D",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "14px",
        "2xl": "20px",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 60px -28px rgba(0,0,0,0.8)",
        glow: "0 0 0 1px rgba(94,234,212,0.25), 0 0 28px -4px rgba(94,234,212,0.35)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(60% 50% at 50% 0%, rgba(94,234,212,0.10) 0%, rgba(94,234,212,0) 70%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(400%)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both",
        scan: "scan 4s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
