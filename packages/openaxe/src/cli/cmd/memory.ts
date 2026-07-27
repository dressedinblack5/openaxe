import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { Memory } from "@opencode-ai/core/memory"

export const MemoryCommand = effectCmd({
  command: "memory <action>",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Action to perform",
        type: "string",
        choices: ["list", "set", "get", "remove"],
      })
      .option("key", { describe: "Memory key", type: "string" })
      .option("value", { describe: "Memory value (for set)", type: "string" }),
  describe: "manage project memory",
  instance: false,
  handler: Effect.fn("Cli.memory")(function* (args) {
    const memory = yield* Memory.Service

    switch (args.action) {
      case "list": {
        const entries = yield* memory.list()
        if (entries.length === 0) {
          console.log("No memory entries found")
        } else {
          for (const entry of entries) {
            console.log(`${entry.kind}\t${entry.scope}\t${entry.source}\t${entry.key}\t${JSON.stringify(entry.value)}`)
          }
        }
        break
      }
      case "set": {
        yield* memory.set(args.key, args.value)
        console.log(`Set ${args.key} = ${args.value}`)
        break
      }
      case "get": {
        const value = yield* memory.get(args.key)
        if (value === null) console.log(`Key "${args.key}" not found`)
        else console.log(JSON.stringify(value))
        break
      }
      case "remove": {
        yield* memory.remove(args.key)
        console.log(`Removed ${args.key}`)
        break
      }
    }
  }),
})
