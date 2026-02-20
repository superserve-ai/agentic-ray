import { Command } from "commander"
import { endSession } from "./end"
import { getSession } from "./get"
import { listSessions } from "./list"

export const sessions = new Command("sessions")
  .description("Manage agent sessions")
  .addCommand(listSessions)
  .addCommand(getSession)
  .addCommand(endSession)
