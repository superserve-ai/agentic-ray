import { afterEach, describe, expect, it, vi } from "vitest"

import { activityListQuery, listActivityPaged } from "./activity"
import type { ActivityListParams } from "./types"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

const baseParams: ActivityListParams = {
  page: 1,
  pageSize: 50,
  sort: "created_at",
  order: "desc",
}

describe("activityListQuery", () => {
  it("maps page/pageSize to limit/offset alongside sort + order", () => {
    const q = new URLSearchParams(
      activityListQuery({ ...baseParams, page: 3, pageSize: 25 }),
    )
    expect(q.get("limit")).toBe("25")
    expect(q.get("offset")).toBe("50") // (3 - 1) * 25
    expect(q.get("sort")).toBe("created_at")
    expect(q.get("order")).toBe("desc")
  })

  it("omits optional filters when unset", () => {
    const q = new URLSearchParams(activityListQuery(baseParams))
    expect(q.has("category")).toBe(false)
    expect(q.has("status")).toBe(false)
    expect(q.has("q")).toBe(false)
    expect(q.has("start")).toBe(false)
    expect(q.has("end")).toBe(false)
  })

  it("includes category, status, q, and the date window when set", () => {
    const q = new URLSearchParams(
      activityListQuery({
        ...baseParams,
        category: "sandbox",
        status: "error",
        q: "web",
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-09T00:00:00.000Z",
      }),
    )
    expect(q.get("category")).toBe("sandbox")
    expect(q.get("status")).toBe("error")
    expect(q.get("q")).toBe("web")
    expect(q.get("start")).toBe("2026-07-01T00:00:00.000Z")
    expect(q.get("end")).toBe("2026-07-09T00:00:00.000Z")
  })
})

describe("listActivityPaged", () => {
  afterEach(() => {
    fetchSpy.mockReset()
  })

  it("GETs /api/activity and reads the total from X-Total-Count", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: "a1" }]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Total-Count": "42",
        },
      }),
    )

    const result = await listActivityPaged({
      ...baseParams,
      category: "sandbox",
    })

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/api/activity?")
    expect(url).toContain("category=sandbox")
    expect(result.total).toBe(42)
    expect(result.items).toEqual([{ id: "a1" }])
  })

  it("falls back to the item count when X-Total-Count is absent", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: "a1" }, { id: "a2" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const result = await listActivityPaged(baseParams)
    expect(result.total).toBe(2)
  })
})
