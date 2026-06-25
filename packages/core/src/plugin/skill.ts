/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpenaxeContent from "./skill/customize-openaxe.md" with { type: "text" }

export const CustomizeOpenaxeContent = customizeOpenaxeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-openaxe",
            description:
              "Use ONLY when the user is editing or creating openaxe's own configuration: openaxe.json, openaxe.jsonc, files under .openaxe/, or files under ~/.config/openaxe/. Also use when creating or fixing openaxe agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring openaxe itself.",
            location: AbsolutePath.make("/builtin/customize-openaxe.md"),
            content: CustomizeOpenaxeContent,
          }),
        }),
      )
    })
  }),
})
