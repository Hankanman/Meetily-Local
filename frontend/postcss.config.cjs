// Tailwind 4: the postcss plugin moved to @tailwindcss/postcss
// (autoprefixer is no longer needed — Tailwind 4 handles vendor prefixes)
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
