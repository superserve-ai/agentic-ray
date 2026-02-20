import { Command } from "commander"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"

export const endSession = new Command("end")
  .description("End an active session")
  .argument("<session-id>", "Session ID or short prefix")
  .action(
    withErrorHandler(async (sessionId: string) => {
      const client = createClient()
      const session = await client.endSession(sessionId)

      log.success(
        `Session ${sessionId} ended (status: ${session.status ?? "?"})`,
      )
    }),
  )
