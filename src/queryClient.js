import { QueryClient } from '@tanstack/react-query'

// Lives in its own module for two reasons: exporting a non-component from App.jsx
// breaks React Fast Refresh, and the test suite needs to reach this instance to
// reset it.
//
// staleTime/gcTime are Infinity because localStorage is the source of truth and never
// changes underneath the app -- writes go through setCompanies(), which invalidates
// the query explicitly. The flip side is that a cached result would survive an entire
// test run, so the suite calls queryClient.clear() before each case.
// Example: queryClient.clear() then render(<App />) reads localStorage fresh.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity } },
})
