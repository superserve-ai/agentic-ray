"use client"

import { useEffect, useState } from "react"
import { createBrowserClient } from "@superserve/supabase"

interface Agent {
  id: string
  name: string
  created_at: string
}

export function useAgents(enabled: boolean) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const supabase = createBrowserClient()
    let cancelled = false

    const fetchAgents = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const { data } = await supabase
        .from("agents")
        .select("id, name, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })

      if (!cancelled && data) {
        setAgents(data)
      }
      setLoading(false)
    }

    setLoading(true)
    fetchAgents()

    const channel = supabase
      .channel("agents-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agents" },
        () => {
          fetchAgents()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [enabled])

  return { agents, loading, hasAgents: agents.length > 0 }
}
