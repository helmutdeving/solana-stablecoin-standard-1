/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        solana: {
          purple: "#9945FF",
          green: "#14F195",
          blue: "#00C2FF",
        },
        surface: {
          900: "#0D0F14",
          800: "#13161E",
          700: "#1A1E28",
          600: "#222733",
        },
        border: {
          DEFAULT: "#2A2F3E",
          subtle: "#1E2230",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
