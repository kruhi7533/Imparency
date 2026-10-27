import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        // Warm off-white page canvas behind white cards (light theme).
        canvas: "#f7f6f2",
        foreground: "var(--foreground)",
        // Retint the darkest canvas shade from generic near-black to a deep
        // navy-black, so every `gray-950` surface app-wide carries the trust
        // hue. One token, whole theme: the canvas itself becomes brand.
        gray: {
          950: "#0a1120",
        },
        // Brand identity — "trust" (deep institutional navy) and "gold" (warmth/impact).
        // Kept as new, uniquely-named tokens (not reusing emerald/teal/amber) so this is
        // purely additive: existing semantic colors (health scores, status badges, risk
        // levels) keep meaning exactly as before and are untouched by this palette.
        trust: {
          // Brightened 2026-10-27 for the light redesign: primary actions are
          // trust-600, hover trust-700, tints trust-50/100.
          50: "#eef3ff",
          100: "#dbe5ff",
          200: "#bccdfc",
          300: "#8eaaf6",
          400: "#5b80ec",
          500: "#3560dd",
          600: "#1f4bc8",
          700: "#1a3ea3",
          800: "#1b3683",
          900: "#1c3168",
          950: "#141f40",
        },
        gold: {
          50: "#fdf8ed",
          100: "#faedc9",
          200: "#f4d98d",
          300: "#edc158",
          400: "#e3a730",
          500: "#d18d1f",
          600: "#b06f18",
          700: "#8c5417",
          800: "#714419",
          900: "#5f3a19",
          950: "#361e0a",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
