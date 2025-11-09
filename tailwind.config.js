/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./views/**/*.{ejs,html,js}",
    "./public/**/*.html"
  ],
  theme: {
    extend: {
      colors: {
        horriver: {
          dark: "#0F0F0F",     // Fundo principal
          red: "#7B1E1E",      // Vermelho vinho do escudo
          orange: "#D96B1B",   // Laranja queimado
          light: "#FFFFFF",    // Branco
          gray: "#EDEDED"      // Cinza claro
        }
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        title: ["Oswald", "system-ui", "sans-serif"]
      },
      boxShadow: {
        card: "0 4px 12px rgba(0, 0, 0, 0.25)",
        glow: "0 0 10px rgba(217, 107, 27, 0.5)"
      },
      backgroundImage: {
        "gradient-horriver": "linear-gradient(135deg, #7B1E1E 0%, #D96B1B 100%)"
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem"
      },
      transitionDuration: {
        DEFAULT: "300ms"
      },
      screens: {
        xs: "480px"
      },
      container: {
        center: true,
        padding: "1rem"
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: 0, transform: "translateY(10px)" },
          "100%": { opacity: 1, transform: "translateY(0)" }
        }
      },
      animation: {
        fadeIn: "fadeIn 0.6s ease-in-out"
      }
    }
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/typography"),
    require("@tailwindcss/aspect-ratio")
  ]
};
