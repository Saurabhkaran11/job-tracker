import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Kept separate from vite.config.js so the app build and the test run do not have to
// share a plugin set -- the Tailwind plugin is irrelevant to jsdom and CSS is not
// parsed during tests.
export default defineConfig({
  plugins: [react()],
  test: {
    // Gives the suite a DOM and a real localStorage, which is the app's source of truth.
    environment: 'jsdom',
    globals: true,
    // Registers jest-dom matchers and clears storage between tests.
    setupFiles: ['./src/setupTests.js'],
    css: false,
    // Each test mounts the whole app, and the bulk-add cases fill a form with fifteen
    // controls before asserting. Vitest's 5s default was close enough to that work to
    // time out intermittently on a loaded machine, which showed up as flakes rather
    // than as real failures.
    testTimeout: 20000,
  },
})
