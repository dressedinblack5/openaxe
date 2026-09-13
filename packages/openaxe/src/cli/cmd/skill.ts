import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { Skill } from "@/skill"
import { UI } from "../ui"

export const SkillCommand = cmd({
  command: "skill",
  describe: "list skills, including auto-generated ones from session history",
  builder: (yargs: Argv) => yargs.command(SkillListCommand).demandCommand(),
  async handler() {},
})

export const SkillListCommand = effectCmd({
  command: "list",
  describe: "list discovered skills (.openaxe/skills/** written by skill generation are included)",
  builder: (yargs) =>
    yargs
      .option("json", {
        describe: "output as JSON",
        type: "boolean",
        default: false,
      })
      .option("verbose", {
        describe: "show location for each skill",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.skill.list")(function* (args) {
    const skill = yield* Skill.Service
    const skills = yield* skill.all()
    const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))
    if (args.json) {
      console.log(
        JSON.stringify(
          sorted.map((s) => ({ name: s.name, description: s.description, location: s.location })),
          null,
          2,
        ),
      )
      return
    }
    if (sorted.length === 0) {
      UI.println("No skills")
      return
    }
    for (const info of sorted) {
      const location = args.verbose ? `  ${info.location}` : ""
      UI.println(`${info.name}${info.description ? ` — ${info.description}` : ""}${location}`)
    }
  }),
})
