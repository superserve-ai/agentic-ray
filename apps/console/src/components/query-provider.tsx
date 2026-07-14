"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createContext, useContext, useState } from "react"

import { ApiError } from "@/lib/api/client"

const QueryScopeContext = createContext("self")

export function useQueryScope(): string {
  return useContext(QueryScopeContext)
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            if (error.status === 401 || error.status === 409) return false
          }
          return failureCount < 3
        },
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function QueryProvider({
  cacheScope = "self",
  children,
}: {
  cacheScope?: string
  children: React.ReactNode
}) {
  const [queryClient] = useState(() => createQueryClient())

  return (
    <QueryScopeContext.Provider value={cacheScope}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </QueryScopeContext.Provider>
  )
}
