'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../src/queryClient'
import { ThemeModeProvider, ToastProvider } from '../src/App'

// The provider stack that used to sit in App.jsx's default export. Router providers
// are gone: Next owns routing now.
// Example: <Providers><HomePage /></Providers>
export default function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeModeProvider>
    </QueryClientProvider>
  )
}
