import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { AxeSync } from "@opencode-ai/core/axe-sync"
import { AxeMdSync } from "@opencode-ai/core/memory/sync"
import { Memory } from "@opencode-ai/core/memory"

export const MemoryCommand = effectCmd({
  command: "memory <action>",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Action to perform",
        type: "string",
        choices: ["save", "load", "list", "get", "set", "remove"],
      })
      .option("key", { describe: "Memory key", type: "string" })
      .option("value", { describe: "Memory value (for set)", type: "string" })
      .option("kind", { describe: "Memory kind", type: "string", default: "general" })
      .option("scope", { describe: "Memory scope", type: "string", default: "project" })
      .option("source", { describe: "Memory source", type: "string", default: "agent" })
      .demandOption(["key"], "key is required for get/set/remove"),
  describe: "manage project memory (AXE.md)",
  instance: true,
  handler: Effect.fn("Cli.memory")(function* (args) {
    const ctx = yield* InstanceRef
    const projectDir = ctx.project.directory

    switch (args.action) {
      case "save": {
        const axeSync = yield* AxeSync.Service
        yield* axeSync.save(projectDir)
        console.log(`Saved memory to ${projectDir}/AXE.md`)
        break
      }
      case "load": {
        const axeMdSync = yield* AxeMdSync.Service
        yield* axeMdSync.load(projectDir)
        console.log(`Loaded memory from ${projectDir}/AXE.md`)
        break
      }
      case "list": {
        const memory = yield* Memory.Service
        const entries = yield* memory.list(args.kind, args.scope, args.source)
        if (entries.length === 0) {
          console.log("No memory entries found")
        } else {
          for (const entry of entries) {
            console.log(`${entry.kind}/${entry.scope}/${entry.source} - ${entry.key}: ${JSON.stringify(entry.value)}`)
          }
        }
        break
      }
      case "get": {
        const memory = yield* Memory.Service
        const value = yield* memory.get(args.key)
        if (value === null) {
          console.log(`Key "${args.key}" not found`)
        } else {
          console.log(JSON.stringify(value))
        }
        break
      }
      case "set": {
        const memory = yield* Memory.Service
        if (!args.value) {
          console.error("Value is required for set")
          process.exit(1)
        }
        yield* memory.set(args.key, args.value, args.kind, args.source)
        console.log(`Set ${args.key} = ${args.value}`)
        break
      }
      case "remove": {
        const memory = yield* Memory.Service
        yield* memory.remove(args.key)
        console.log(`Removed ${args.key}`)
        break
      }
    }
  }),
})