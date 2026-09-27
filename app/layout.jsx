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
        {/* First thing in the body, so a saved dark preference is on the document
            before anything paints. The theme provider only reads storage after mount --
            reading it during the first render is what broke hydration -- so without
            this the page would flash light first.
            App Router owns <head>; a script placed there is not executed, so it goes
            here instead. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('job-tracker-theme');if(m!=='dark'&&m!=='light')m=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(m==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
