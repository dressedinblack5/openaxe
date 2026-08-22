import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".openaxe")])),
})

const root = LayerNode.group([ToolRegistry.node, Agent.node])
const replacements = [
  LayerNode.replace(Config.node, configLayer),
  LayerNode.replace(RuntimeFlags.node, RuntimeFlags.layer()),
]

const it = testEffect(LayerNode.buildLayer(root, { replacements }))

afterEach(async () => {
  await disposeAllInstances()
})

const toolContext = (agent: string) =>
  ({
    sessionID: SessionID.make("ses_v1_bridge_test"),
    messageID: MessageID.make("msg_v1_bridge_test"),
    agent,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }) satisfies Tool.Context

describe("tool.registry v1 bridges", () => {
  it.instance("registers kanban, session_search, skill_write, tool_search as builtin tools", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("kanban")
      expect(ids).toContain("session_search")
      expect(ids).toContain("skill_write")
      expect(ids).toContain("tool_search")
    }),
  )

  it.instance("kanban creates a board and a card end-to-end", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const agent = (yield* agents.defaultInfo()).name
      const all = yield* registry.all()
      const kanban = all.find((tool) => tool.id === "kanban")
      if (!kanban) throw new Error("kanban tool not found")

      const boardResult = yield* kanban.execute({ operation: "create_board", title: "Swarm board" }, toolContext(agent))
      expect(boardResult.output).toContain("Board")
      expect(boardResult.output).toContain("Swarm board")

      const cardResult = yield* kanban.execute(
        { operation: "create_card", boardId: "bogus-board", title: "First task" },
        toolContext(agent),
      )
      expect(cardResult.output).toContain("First task")

      const listResult = yield* kanban.execute({ operation: "list_cards" }, toolContext(agent))
      expect(listResult.output).toContain("First task")
    }),
  )

  it.instance("session_search returns no matches on an empty index", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const agent = (yield* agents.defaultInfo()).name
      const all = yield* registry.all()
      const sessionSearch = all.find((tool) => tool.id === "session_search")
      if (!sessionSearch) throw new Error("session_search tool not found")

      const result = yield* sessionSearch.execute({ query: "flurbinator" }, toolContext(agent))
      expect(result.title).toBe("No matching sessions")
    }),
  )

  it.instance("skill_write writes a skill into the project .openaxe/skills directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const agent = (yield* agents.defaultInfo()).name
      const all = yield* registry.all()
      const skillWrite = all.find((tool) => tool.id === "skill_write")
      if (!skillWrite) throw new Error("skill_write tool not found")

      const result = yield* skillWrite.execute(
        { operation: "write", name: "v1-bridge-skill", content: "# V1 Bridge Skill\n\nTest body" },
        toolContext(agent),
      )
      expect(result.output).toContain("Skill created")
      const target = path.join(test.directory, ".openaxe", "skills", "v1-bridge-skill", "SKILL.md")
      const written = yield* Effect.promise(() => fs.readFile(target, "utf8"))
      expect(written).toContain("name: v1-bridge-skill")
      expect(written).toContain("V1 Bridge Skill")

      const listResult = yield* skillWrite.execute({ operation: "list" }, toolContext(agent))
      expect(listResult.output).toContain("v1-bridge-skill")
    }),
  )

  it.instance("tool_search finds builtin tools by name and description", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const agent = (yield* agents.defaultInfo()).name
      const all = yield* registry.all()
      const toolSearch = all.find((tool) => tool.id === "tool_search")
      if (!toolSearch) throw new Error("tool_search tool not found")

      const byName = yield* toolSearch.execute({ query: "kanban" }, toolContext(agent))
      expect(byName.output).toContain("kanban:")

      const byDescription = yield* toolSearch.execute({ query: "full-text" }, toolContext(agent))
      expect(byDescription.output).toContain("session_search:")
    }),
  )
})
