import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  downloadWithLimit,
  filenameFromContentDisposition,
  filesUrl,
  isValidAbsolutePath,
  joinPath,
  listDir,
  parentPath,
  pathSegments,
  sortEntries,
  uploadFileTo,
  type DirEntry,
} from "./files"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

const sandbox = { id: "sbx-1", access_token: "tok-abc" }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/**
 * A streaming Response whose body emits the given chunks one read() at a time,
 * so downloadWithLimit's byte accounting and idle-timer logic are exercised the
 * same way a real network stream would drive them.
 */
function streamResponse(
  chunks: Uint8Array[],
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  })
}

describe("path helpers", () => {
  it("filesUrl encodes the path and appends params", () => {
    const url = filesUrl("sbx-1", "/home/user/a b.txt", { format: "json" })
    expect(url).toContain("boxd-sbx-1.")
    expect(url).toContain("/files?path=%2Fhome%2Fuser%2Fa%20b.txt")
    expect(url).toContain("format=json")
  })

  it("isValidAbsolutePath rejects relative and traversal paths", () => {
    expect(isValidAbsolutePath("/home/user")).toBe(true)
    expect(isValidAbsolutePath("home/user")).toBe(false)
    expect(isValidAbsolutePath("/home/../etc")).toBe(false)
    expect(isValidAbsolutePath("/home/./x")).toBe(false)
  })

  it("joinPath joins a dir and a name with exactly one slash", () => {
    expect(joinPath("/home/user", "a.txt")).toBe("/home/user/a.txt")
    expect(joinPath("/home/user/", "a.txt")).toBe("/home/user/a.txt")
    expect(joinPath("/", "a.txt")).toBe("/a.txt")
  })

  it("parentPath climbs one level and bottoms out at root", () => {
    expect(parentPath("/home/user/dir")).toBe("/home/user")
    expect(parentPath("/home/user/dir/")).toBe("/home/user")
    expect(parentPath("/home")).toBe("/")
    expect(parentPath("/")).toBe("/")
  })

  it("pathSegments yields cumulative crumbs", () => {
    expect(pathSegments("/home/user/proj")).toEqual([
      { name: "home", path: "/home" },
      { name: "user", path: "/home/user" },
      { name: "proj", path: "/home/user/proj" },
    ])
    expect(pathSegments("/")).toEqual([])
  })

  it("filenameFromContentDisposition reduces to a safe basename", () => {
    expect(filenameFromContentDisposition('attachment; filename="a.txt"')).toBe(
      "a.txt",
    )
    expect(
      filenameFromContentDisposition('attachment; filename="../../etc/passwd"'),
    ).toBe("passwd")
    expect(filenameFromContentDisposition(null)).toBeNull()
  })
})

describe("sortEntries", () => {
  it("orders directories before files, then alphabetically", () => {
    const entries: DirEntry[] = [
      { name: "zebra.txt", is_dir: false, size: 1, modified_unix: 0 },
      { name: "src", is_dir: true, size: 0, modified_unix: 0 },
      { name: "apple.txt", is_dir: false, size: 1, modified_unix: 0 },
      { name: "Docs", is_dir: true, size: 0, modified_unix: 0 },
    ]
    expect(sortEntries(entries).map((e) => e.name)).toEqual([
      "Docs",
      "src",
      "apple.txt",
      "zebra.txt",
    ])
  })

  it("does not mutate the input array", () => {
    const entries: DirEntry[] = [
      { name: "b", is_dir: false, size: 0, modified_unix: 0 },
      { name: "a", is_dir: false, size: 0, modified_unix: 0 },
    ]
    sortEntries(entries)
    expect(entries.map((e) => e.name)).toEqual(["b", "a"])
  })
})

describe("listDir", () => {
  beforeEach(() => fetchSpy.mockReset())

  it("lists via the control-plane API and returns sorted entries", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        entries: [
          { name: "b.txt", is_dir: false, size: 2, modified_unix: 10 },
          { name: "sub", is_dir: true, size: 0, modified_unix: 5 },
        ],
      }),
    )

    const entries = await listDir(sandbox, "/home/user")

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe("/api/sandboxes/sbx-1/files/?path=%2Fhome%2Fuser")
    expect(entries.map((e) => e.name)).toEqual(["sub", "b.txt"])
  })

  it("treats a missing entries array as empty", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}))
    expect(await listDir(sandbox, "/home/user")).toEqual([])
  })

  it("throws ApiError with the status on a non-OK response", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { error: { code: "not_found", message: "Folder not found." } },
        404,
      ),
    )
    await expect(listDir(sandbox, "/home/user/missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    })
  })
})

describe("uploadFileTo", () => {
  beforeEach(() => fetchSpy.mockReset())

  it("POSTs the file to <dir>/<name> with the access token", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }))
    const file = new File(["hi"], "note.txt", { type: "text/plain" })

    const target = await uploadFileTo(sandbox, "/home/user", file)

    expect(target).toBe("/home/user/note.txt")
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain("/files?path=%2Fhome%2Fuser%2Fnote.txt")
    expect(url).not.toContain("format=")
    expect(init.method).toBe("POST")
    expect(init.headers["X-Access-Token"]).toBe("tok-abc")
    expect(init.body).toBe(file)
  })

  it("rejects a traversal target before calling fetch", async () => {
    const file = new File(["x"], "../escape.txt")
    await expect(uploadFileTo(sandbox, "/home/user", file)).rejects.toThrow(
      /absolute/i,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws the parsed upstream error on a non-OK response", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "disk full" }), { status: 507 }),
    )
    const file = new File(["x"], "a.txt")
    await expect(uploadFileTo(sandbox, "/home/user", file)).rejects.toThrow(
      /disk full/,
    )
  })
})

describe("downloadWithLimit", () => {
  beforeEach(() => fetchSpy.mockReset())

  it("resolves with the blob and content-disposition for an under-cap body", async () => {
    const chunk = new Uint8Array([1, 2, 3, 4, 5])
    fetchSpy.mockResolvedValue(
      streamResponse([chunk], {
        headers: { "content-disposition": 'attachment; filename="out.zip"' },
      }),
    )

    const { blob, contentDisposition } = await downloadWithLimit(
      "https://boxd-sbx-1.example/files?path=%2Ffile",
      { headers: { "X-Access-Token": "tok-abc" } },
    )

    expect(blob.size).toBe(5)
    expect(contentDisposition).toBe('attachment; filename="out.zip"')
    const [, init] = fetchSpy.mock.calls[0]
    expect(init.method).toBe("GET")
    expect(init.headers["X-Access-Token"]).toBe("tok-abc")
    // A composed AbortController signal is always passed to fetch.
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("rejects when the streamed body exceeds maxBytes", async () => {
    // Two 4-byte chunks (8 bytes total) against a 6-byte cap.
    const chunks = [new Uint8Array(4), new Uint8Array(4)]
    fetchSpy.mockResolvedValue(streamResponse(chunks))

    await expect(
      downloadWithLimit("https://boxd-sbx-1.example/files?path=%2Fbig", {
        maxBytes: 6,
      }),
    ).rejects.toThrow(/exceeds the maximum size/i)
  })

  it("throws a DownloadError carrying the status on a non-OK response", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "gone" }), { status: 404 }),
    )

    await expect(
      downloadWithLimit("https://boxd-sbx-1.example/files?path=%2Fmissing"),
    ).rejects.toMatchObject({ name: "DownloadError", status: 404 })
  })

  it("aborts the fetch when the caller's signal aborts", async () => {
    const ac = new AbortController()
    let fetchSignal: AbortSignal | undefined
    // A real fetch settles on abort. The mock mirrors that: it rejects as soon
    // as the (composed) signal aborts, and never returns an endless promise.
    fetchSpy.mockImplementation(
      (_url?: string, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          const sig = init?.signal
          fetchSignal = sig ?? undefined
          const fail = () => reject(new DOMException("Aborted", "AbortError"))
          if (!sig) {
            // Stray call without a signal: settle immediately, don't hang.
            resolve(streamResponse([new Uint8Array(1)]))
          } else if (sig.aborted) {
            fail()
          } else {
            sig.addEventListener("abort", fail, { once: true })
          }
        }),
    )

    const promise = downloadWithLimit(
      "https://boxd-sbx-1.example/files?path=%2Fslow",
      { signal: ac.signal },
    )
    ac.abort()

    await expect(promise).rejects.toThrow(/abort/i)
    expect(fetchSignal?.aborted).toBe(true)
  })

  it("rejects an already-aborted caller signal", async () => {
    const ac = new AbortController()
    ac.abort()
    fetchSpy.mockImplementation((_url?: string, init?: RequestInit) =>
      init?.signal?.aborted
        ? Promise.reject(new DOMException("Aborted", "AbortError"))
        : Promise.resolve(streamResponse([new Uint8Array(1)])),
    )

    await expect(
      downloadWithLimit("https://boxd-sbx-1.example/files?path=%2Fx", {
        signal: ac.signal,
      }),
    ).rejects.toThrow(/abort/i)
  })
})
