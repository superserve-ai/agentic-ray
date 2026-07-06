/** `sandbox_files_read`, `sandbox_files_write`, `sandbox_files_list`. */

import { ValidationError } from "@superserve/sdk"
import { z } from "zod"

import type { SandboxClient } from "../client.js"
import {
  MAX_DOWNLOAD_DIR_BYTES,
  MAX_FILE_BYTES,
  MAX_WRITE_BYTES,
} from "../constants.js"
import { formatSdkError } from "../lib/errors.js"
import { toolError, toolOk } from "../lib/result.js"
import type { McpServer } from "../lib/sdk.js"
import { defineTool } from "../lib/tool.js"

const mib = (bytes: number): string =>
  `${Math.round(bytes / (1024 * 1024))} MiB`

/** Guidance returned when a read exceeds {@link MAX_FILE_BYTES}. */
function fileTooLargeMessage(path: string): string {
  return (
    `${path} is larger than the ${mib(MAX_FILE_BYTES)} sandbox_files_read limit. ` +
    `Read a slice with sandbox_exec instead — e.g. \`head -c ${MAX_FILE_BYTES} ${path}\` for text, ` +
    `or \`base64 -w0 ${path}\` piped through \`head\` for binary — or download the whole file with the Superserve SDK/CLI.`
  )
}

/** Guidance returned when a directory zip exceeds {@link MAX_DOWNLOAD_DIR_BYTES}. */
function dirTooLargeMessage(path: string): string {
  return (
    `${path} zips to more than the ${mib(MAX_DOWNLOAD_DIR_BYTES)} sandbox_files_download_dir limit. ` +
    `Download a smaller subdirectory, pull individual files with sandbox_files_read, ` +
    `or use the Superserve SDK/CLI (files.downloadDir) for the full archive.`
  )
}

/** Guidance returned when a write exceeds {@link MAX_WRITE_BYTES}. */
function writeTooLargeMessage(path: string, bytes: number): string {
  return (
    `Refusing to write ${bytes} bytes to ${path}: sandbox_files_write inline content is limited to ${mib(MAX_WRITE_BYTES)}. ` +
    `Upload larger files with the Superserve SDK/CLI, or append in smaller chunks via sandbox_exec.`
  )
}

/** Decoded size of `data` in bytes (text is measured as UTF-8). */
function byteLengthOf(data: string | Uint8Array): number {
  return typeof data === "string"
    ? Buffer.byteLength(data, "utf8")
    : data.byteLength
}

type Encoding = "text" | "base64"

interface ReadArgs {
  sandbox_id: string
  path: string
  encoding: Encoding
}

interface WriteArgs {
  sandbox_id: string
  path: string
  content: string
  encoding: Encoding
}

interface ListArgs {
  sandbox_id: string
  path: string
}

interface DownloadDirArgs {
  sandbox_id: string
  path: string
}

const encoding = z
  .enum(["text", "base64"])
  .default("text")
  .describe('"text" for UTF-8 (default), "base64" for binary content.')

const absolutePath = z
  .string()
  .describe('Absolute path inside the sandbox, e.g. "/app/main.py".')

export function registerFileTools(
  server: McpServer,
  client: SandboxClient,
): void {
  defineTool<ReadArgs>(
    server,
    "sandbox_files_read",
    {
      title: "Read a file from a sandbox",
      description:
        "Read a file from a sandbox. Returns UTF-8 text by default, or base64 when encoding is set to base64 " +
        "(use it for binary files). Files larger than 1 MiB are rejected — read a slice with sandbox_exec instead.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        path: absolutePath,
        encoding,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, path, encoding: enc }) => {
      try {
        // Cap the download at the SDK boundary so a hostile/accidental large
        // file never buffers up to the SDK's 2 GiB default in this process.
        const bytes = await client.readFile(sandbox_id, path, MAX_FILE_BYTES)
        const content =
          enc === "base64"
            ? Buffer.from(bytes).toString("base64")
            : new TextDecoder().decode(bytes)
        const structured = {
          path,
          content,
          encoding: enc,
          bytes: bytes.byteLength,
        }
        return toolOk(
          `read ${bytes.byteLength} bytes from ${path}\n${content}`,
          structured,
        )
      } catch (e) {
        // The SDK rejects an over-cap download with ValidationError; turn that
        // into actionable guidance rather than a generic "invalid request".
        if (e instanceof ValidationError && /maximum size/i.test(e.message)) {
          return toolError(fileTooLargeMessage(path))
        }
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<WriteArgs>(
    server,
    "sandbox_files_write",
    {
      title: "Write a file to a sandbox",
      description:
        "Write a file to a sandbox, creating or overwriting it. Parent directories are created automatically. " +
        "Set encoding to base64 to write binary content. Inline content is limited to 8 MiB; upload larger files with the SDK/CLI.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        path: absolutePath,
        content: z
          .string()
          .describe(
            "File content (UTF-8 text, or base64 when encoding=base64).",
          ),
        encoding,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, path, content, encoding: enc }) => {
      try {
        const data =
          enc === "base64"
            ? new Uint8Array(Buffer.from(content, "base64"))
            : content
        const bytes = byteLengthOf(data)
        // Bound the write before touching the network so a large (post-decode)
        // payload cannot pin host memory on the hosted server.
        if (bytes > MAX_WRITE_BYTES) {
          return toolError(writeTooLargeMessage(path, bytes))
        }
        await client.writeFile(sandbox_id, path, data)
        return toolOk(`wrote ${bytes} bytes to ${path}`, { path, bytes })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<ListArgs>(
    server,
    "sandbox_files_list",
    {
      title: "List a directory in a sandbox",
      description:
        "List directory contents in a sandbox. Returns name, type (file/directory/symlink), size, and " +
        "modification time for each entry.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        path: absolutePath.describe(
          'Absolute directory path to list, e.g. "/app".',
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, path }) => {
      try {
        const entries = await client.listDir(sandbox_id, path)
        const text = entries.length
          ? entries
              .map(
                (e) =>
                  `${e.type === "directory" ? "d" : "-"} ${e.size}\t${e.name}`,
              )
              .join("\n")
          : "(empty directory)"
        return toolOk(`${path}\n${text}`, { path, entries })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<DownloadDirArgs>(
    server,
    "sandbox_files_download_dir",
    {
      title: "Download a directory as a zip",
      description:
        "Download a directory from a sandbox as a ZIP archive, returned base64-encoded in the result's structured " +
        "content (symlinks are skipped). Use this to pull a whole folder — build output, results, a small project — " +
        `in one call. Directories that zip to more than ${mib(MAX_DOWNLOAD_DIR_BYTES)} are rejected: grab a ` +
        "subdirectory, pull individual files with sandbox_files_read, or use the Superserve SDK/CLI for the full archive.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        path: absolutePath.describe(
          'Absolute directory path to download, e.g. "/app/output".',
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, path }) => {
      try {
        // Cap pushed to the SDK so an over-cap directory is rejected mid-stream,
        // never fully buffered (the zip is base64'd into the response).
        const bytes = await client.downloadDir(
          sandbox_id,
          path,
          MAX_DOWNLOAD_DIR_BYTES,
        )
        const content = Buffer.from(bytes).toString("base64")
        // base64 (large) goes in structuredContent for the client to save; the
        // text block stays a short summary so it doesn't flood the model context.
        return toolOk(
          `downloaded ${path} as a zip (${bytes.byteLength} bytes; base64 in structured content)`,
          {
            path,
            format: "zip",
            encoding: "base64",
            bytes: bytes.byteLength,
            content,
          },
        )
      } catch (e) {
        if (e instanceof ValidationError && /maximum size/i.test(e.message)) {
          return toolError(dirTooLargeMessage(path))
        }
        return toolError(formatSdkError(e))
      }
    },
  )
}
