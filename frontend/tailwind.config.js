/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // legacy names kept so nothing breaks; values retuned to the cyber-organic palette
        forest: { 50: "#0f201b", 100: "#14302a", 600: "#10b981", 700: "#34d399", 800: "#10b981", 900: "#0b1712", 950: "#09120e" },
        wheat: { 100: "rgba(245,158,11,.10)", 400: "#fbbf24", 500: "#f59e0b" },
        paper: "#070d0b",
        abyss: { DEFAULT: "#070d0b", 900: "#09120e", 800: "#0a1310", 700: "#0f201b" },
        caution: "#f59e0b",
        alert: "#f43f5e",
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans Devanagari", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 0 0 1px rgba(16,185,129,.04), 0 8px 32px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.03)",
        glow: "0 0 24px rgba(16,185,129,.35)",
      },
    },
  },
  plugins: [],
};
