import './globals.css'
import './App.css'
import Providers from './providers'

// A server component: it only sets document chrome. Everything interactive lives
// under Providers, which is a client component.
// oxlint-disable-next-line react/only-export-components -- Next requires this export
export const metadata = {
  title: 'Job Tracker',
  description: 'Track every application, every link, every resume',
}

export default function RootLayout({ children }) {
  // suppressHydrationWarning: the theme provider adds `class="dark"` to <html> on the
  // client from a saved preference, so the served markup and the first client render
  // legitimately differ on that one attribute.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
