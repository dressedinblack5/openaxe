import { Context } from "effect"

export const CurrentWorkingDirectory = Context.Reference<string>("CurrentWorkingDirectory", {
  defaultValue: () => process.env.OPENAXE_DIRECTORY ?? process.cwd(),
})
