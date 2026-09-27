import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pinned because there is a package-lock.json above this directory, outside the
  // repo, which Turbopack would otherwise treat as the workspace root.
  turbopack: { root: dir },
}

// Note: `output: 'export'` is deliberately NOT set. Company ids are created at runtime
// with crypto.randomUUID() and live only in the visitor's localStorage, so
// /company/[id] has no set of paths to pre-render -- a static export requires
// generateStaticParams(), which cannot be written for data that does not exist at
// build time. The route is rendered on demand instead.

export default nextConfig
