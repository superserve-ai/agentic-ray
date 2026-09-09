import { ConflictError, Sandbox, Template } from "@superserve/sdk"
import { describe, expect, it } from "vitest"

import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

describe.skipIf(!hasCredentials())("templates", () => {
  const opts = hasCredentials()
    ? connectionOptions()
    : { apiKey: "", baseUrl: "" }

  it("lists templates (includes system templates)", async () => {
    const list = await Template.list(opts)
    expect(list.length).toBeGreaterThan(0)
    expect(list.some((t) => t.name.startsWith("superserve/"))).toBe(true)
  })

  it("full lifecycle: multi-step build, launch, verify, rebuild idempotency, conflict-on-delete", async () => {
    const name = `sdk-e2e-tpl-${RUN_ID}`
    const template = await Template.create({
      ...opts,
      name,
      vcpu: 2,
      memoryMib: 2048,
      diskMib: 4096,
      from: "python:3.11",
      steps: [
        { run: "mkdir -p /srv/app" },
        { workdir: "/srv/app" },
        { env: { key: "GREETING", value: "hello-from-build" } },
        { run: 'sh -c "echo $GREETING > /srv/app/greet.txt"' },
        { run: "python --version > /srv/app/pyver.txt 2>&1" },
      ],
    })
    expect(template.name).toBe(name)
    expect(template.vcpu).toBe(2)
    expect(template.memoryMib).toBe(2048)

    try {
      await template.waitUntilReady({
        onLog: (ev) => {
          if (ev.stream === "stdout" || ev.stream === "stderr") {
            process.stdout.write(ev.text)
          }
        },
      })

      const fresh = await template.getInfo()
      expect(fresh.status).toBe("ready")
      expect(fresh.builtAt).toBeInstanceOf(Date)

      // listBuilds shows the build that just finished
      const builds = await template.listBuilds()
      expect(builds.length).toBeGreaterThanOrEqual(1)
      expect(builds[0].status).toBe("ready")

      // Rebuild with same spec → idempotent (same hash returns existing build)
      const rebuilt = await template.rebuild()
      expect(rebuilt.buildSpecHash).toBe(builds[0].buildSpecHash)

      // Launch a sandbox, verify all build-step effects propagate to runtime
      const sandbox = await Sandbox.create({
        ...opts,
        name: `sdk-e2e-tpl-sbx-${RUN_ID}`,
        fromTemplate: template,
      })
      try {
        // env var from build step persists at runtime
        const env = await sandbox.commands.run("printenv GREETING")
        expect(env.stdout.trim()).toBe("hello-from-build")

        // workdir from build step is the runtime cwd
        const cwd = await sandbox.commands.run("pwd")
        expect(cwd.stdout.trim()).toBe("/srv/app")

        // file written during build is present
        const greet = await sandbox.commands.run("cat /srv/app/greet.txt")
        expect(greet.stdout.trim()).toBe("hello-from-build")

        // python build-step output is on disk
        const pyver = await sandbox.commands.run("cat /srv/app/pyver.txt")
        expect(pyver.exitCode).toBe(0)
        expect(pyver.stdout.trim()).toMatch(/^Python 3\.11/)

        // Deleting the template while the sandbox still references it → 409
        await expect(template.delete()).rejects.toBeInstanceOf(ConflictError)
      } finally {
        try {
          await sandbox.kill()
        } catch (err) {
          console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
        }
      }
    } finally {
      try {
        await template.delete()
      } catch (err) {
        console.error(`Cleanup failed for template ${template.id}:`, err)
      }
    }
  }, 600_000)

  it("BuildError: failed build raises BuildError with parsed code", async () => {
    const name = `sdk-e2e-tpl-fail-${RUN_ID}`
    const template = await Template.create({
      ...opts,
      name,
      from: "python:3.11",
      // Force a step failure as quickly as possible: `false` exits 1.
      steps: [{ run: "false" }],
    })

    try {
      await expect(template.waitUntilReady()).rejects.toMatchObject({
        name: "BuildError",
        templateId: template.id,
      })
    } finally {
      try {
        await template.delete()
      } catch (err) {
        console.error(`Cleanup failed for template ${template.id}:`, err)
      }
    }
  }, 300_000)
})
