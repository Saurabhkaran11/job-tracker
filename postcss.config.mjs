// Tailwind v4 runs through PostCSS under Next; the Vite plugin it used before does
// not apply here.
const config = { plugins: { '@tailwindcss/postcss': {} } }
export default config
