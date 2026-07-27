import { createServerClient as _createServerClient } from "@supabase/ssr"

export async function createServerClient() {
  const { cookies } = await import("next/headers")
  const cookieStore = await cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  }

  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
  const domainOpts =
    cookieDomain && process.env.VERCEL_ENV !== "preview"
      ? { domain: cookieDomain }
      : {}

  return _createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, { ...options, ...domainOpts })
          }
        } catch {
          // Called from Server Component — safe to ignore with middleware session refresh
        }
      },
    },
  })
}
