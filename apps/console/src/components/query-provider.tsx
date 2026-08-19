"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createContext, useContext, useState } from "react"

import { ApiError } from "@/lib/api/client"

const QueryScopeContext = createContext("self")
export interface DashboardTeamContextValue {
  teamId: string
  region: string
  name: string
}

const DashboardTeamContext = createContext<DashboardTeamContextValue | null>(
  null,
)

export function useQueryScope(): string {
  return useContext(QueryScopeContext)
}

export function useDashboardTeamContext(): DashboardTeamContextValue | null {
  return useContext(DashboardTeamContext)
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
  teamContext = null,
  children,
}: {
  cacheScope?: string
  teamContext?: DashboardTeamContextValue | null
  children: React.ReactNode
}) {
  const [queryClient] = useState(() => createQueryClient())

  return (
    <QueryScopeContext.Provider value={cacheScope}>
      <DashboardTeamContext.Provider value={teamContext}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </DashboardTeamContext.Provider>
    </QueryScopeContext.Provider>
  )
}
