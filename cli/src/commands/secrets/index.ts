import { Command } from "commander"
import { deleteSecret } from "./delete"
import { listSecrets } from "./list"
import { setSecrets } from "./set"

export const secrets = new Command("secrets")
  .description("Manage agent secrets and environment variables")
  .addCommand(setSecrets)
  .addCommand(listSecrets)
  .addCommand(deleteSecret)
