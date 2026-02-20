import { Command } from "commander"
import { deleteAgent } from "./delete"
import { getAgent } from "./get"
import { listAgents } from "./list"

export const agents = new Command("agents")
  .description("Manage hosted agents")
  .addCommand(listAgents)
  .addCommand(getAgent)
  .addCommand(deleteAgent)
