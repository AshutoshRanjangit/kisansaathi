/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        forest: { 50: "#f0f7f2", 100: "#dcefe2", 600: "#15803d", 700: "#166534", 800: "#14532d", 900: "#0f3d22", 950: "#0a2a17" },
        wheat: { 100: "#fef6d8", 400: "#facc15", 500: "#eab308" },
        paper: "#f6f8f4",
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans Devanagari", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: { card: "0 1px 2px rgba(16,40,24,.06), 0 4px 16px rgba(16,40,24,.06)" },
    },
  },
  plugins: [],
};
