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
          50: "#f0f4fb",
          100: "#dde6f6",
          200: "#b9caed",
          300: "#8ea9e0",
          400: "#5f83cf",
          500: "#3c62ba",
          600: "#2b4a9c",
          700: "#243c7d",
          800: "#1f3266",
          900: "#1b2b54",
          950: "#0f1730",
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
