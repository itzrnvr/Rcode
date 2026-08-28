/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#1a1a2e", panel: "#16213e", hover: "#0f3460", accent: "#533483" },
        text: { DEFAULT: "#e0e0e0", muted: "#8888aa", dim: "#555577" },
        border: "#233",
        accent: "#7b2ff7",
        side: { 0: "#533483", 1: "#7b2ff7", 2: "#9d4edd", 3: "#c77dff", 4: "#e0aaff" },
      },
    },
  },
  plugins: [],
};
