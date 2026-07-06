/**
 * React Query test helpers.
 *
 * Returns a fresh `QueryClient` (retries disabled, cache unshared) and a
 * wrapper component to use with `renderHook` / `render`. Never share the
 * client across tests — each test should get its own to avoid state bleed.
 *
 *   import { createQueryWrapper } from "@/test/react-query"
 *   import { renderHook, waitFor } from "@testing-library/react"
 *
 *   const { wrapper, queryClient } = createQueryWrapper()
 *   const { result } = renderHook(() => useSandboxesPage(params), { wrapper })
 *   await waitFor(() => expect(result.current.isSuccess).toBe(true))
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        // Long enough that invalidate-without-observer doesn't GC the
        // optimistic state we're asserting on. Each test gets its own
        // client so state still doesn't leak between tests.
        gcTime: 5 * 60 * 1000,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function createQueryWrapper() {
  const queryClient = createQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}
