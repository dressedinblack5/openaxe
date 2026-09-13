import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { Kanban } from "@opencode-ai/core/kanban/kanban"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { BackgroundJob } from "@/background/job"
import { Database } from "@opencode-ai/core/database/database"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".openaxe")])),
})

const mockSessionLayer = Layer.mock(Session.Service, {
  get: (id) =>
    Effect.succeed({
      id,
      slug: "test",
      version: "1.0.0",
      projectID: "test-project" as any,
      directory: "/tmp",
      workspaceID: undefined,
      parentID: undefined,
      title: "Test Session",
      agent: "test-agent",
      model: undefined,
      metadata: undefined,
      permission: undefined,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now(), updated: Date.now() },
      share: undefined,
      summary: undefined,
      revert: undefined,
    } as any),
  create: (input = {}) =>
    Effect.succeed({
      id: SessionID.make("ses_new_session"),
      slug: "test",
      version: "1.0.0",
      projectID: "test-project" as any,
      directory: "/tmp",
      workspaceID: input.workspaceID,
      parentID: input.parentID,
      title: input.title ?? "New Session",
      agent: input.agent,
      model: input.model,
      metadata: input.metadata,
      permission: input.permission,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now(), updated: Date.now() },
      share: undefined,
      summary: undefined,
      revert: undefined,
    } as any),
}) as any

const root = LayerNode.group([
  ToolRegistry.node,
  Agent.node,
  SessionPrompt.node,
  Session.node,
  BackgroundJob.node,
  Kanban.node,
  Database.node,
  SessionProjector.node,
])
const replacements = [
  LayerNode.replace(Config.node, configLayer),
  LayerNode.replace(RuntimeFlags.node, RuntimeFlags.layer()),
  LayerNode.replace(Session.node, mockSessionLayer),
]

const it = testEffect(LayerNode.buildLayer(root, { replacements }))

// Real Session service (no mock) so the parentID chain is walkable; config
// pins the depth limit the enforcement test exercises.
const itDepth = testEffect(
  LayerNode.buildLayer(root, {
    replacements: [
      LayerNode.replace(
        Config.node,
        TestConfig.layer({
          get: () => Effect.succeed({ experimental: { subagent_depth_limit: 1 } }),
          directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".openaxe")])),
        }),
      ),
      LayerNode.replace(RuntimeFlags.node, RuntimeFlags.layer()),
    ],
  }),
)

afterEach(async () => {
  await disposeAllInstances()
})

const toolContext = (agent: string) =>
  ({
    sessionID: SessionID.make("ses_kanban_swarm_test"),
    messageID: MessageID.make("msg_kanban_swarm_test"),
    agent,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
    extra: {
      promptOps: {
        cancel: () => Effect.void,
        resolvePromptParts: (template: string) => Effect.succeed([{ type: "text", text: template }]),
        prompt: (input: {
          sessionID: SessionID
          model: { modelID: string; providerID: string }
          agent: string
          variant?: string
          parts: { type: string; text: string }[]
        }) =>
          Effect.succeed({
            info: {
              id: MessageID.make("test"),
              role: "assistant",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              modelID: input.model.modelID,
              providerID: input.model.providerID,
              agent: input.agent,
              variant: input.variant,
              path: { cwd: "/tmp", root: "/tmp" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            },
            parts: [{ type: "text", text: "Task completed successfully" }],
          }),
      } satisfies {
        cancel: (sessionID: SessionID) => Effect.Effect<void>
        resolvePromptParts: (template: string) => Effect.Effect<{ type: string; text: string }[]>
        prompt: (input: {
          sessionID: SessionID
          model: { modelID: string; providerID: string }
          agent: string
          parts: { type: string; text: string }[]
        }) => Effect.Effect<{ info: any; parts: { type: string; text: string }[] }>
      },
    },
  }) satisfies Tool.Context

describe("kanban-swarm tool", () => {
  it.instance("registers kanban-swarm as a builtin tool", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("kanban-swarm")
    }),
  )

  it.instance("creates a worker card (without spawning subagent in test)", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const agent = (yield* agents.defaultInfo()).name
      const all = yield* registry.all()
      const kanbanSwarm = all.find((tool) => tool.id === "kanban-swarm")
      if (!kanbanSwarm) throw new Error("kanban-swarm tool not found")

      // First create a board using the kanban tool
      const kanbanTool = all.find((tool) => tool.id === "kanban")
      if (!kanbanTool) throw new Error("kanban tool not found")

      const boardResult = yield* kanbanTool.execute(
        { operation: "create_board", title: "Swarm board" },
        toolContext(agent),
      )
      expect(boardResult.output).toContain("Board")

      // Extract board ID from output
      const boardIdMatch = boardResult.output.match(/Board ([^\s]+)/)
      if (!boardIdMatch) throw new Error("Could not extract board ID")
      const boardId = boardIdMatch[1]

      // Test complete_worker operation (doesn't spawn subagent)
      const kanbanService = yield* Kanban.Service
      const card = yield* kanbanService.createCard({
        boardId,
        rootSessionId: "test-root",
        title: "Test worker task",
        status: "in_progress",
      })

      const completeResult = yield* kanbanSwarm.execute(
        {
          operation: "complete_worker",
          boardId,
          cardId: card.id,
          verification: { result: "Work completed", timestamp: Date.now() },
        },
        toolContext(agent),
      )
      expect(completeResult.title).toContain("Completed worker")
      expect(completeResult.output).toContain("Test worker task")

      // Verify card status is updated to done
      const updatedCard = yield* kanbanService.getBoard(boardId).pipe(
        Effect.flatMap((_board) => kanbanService.listCards({ boardId })),
        Effect.map((cards) => cards.find((c) => c.id === card.id)),
      )
      expect(updatedCard).toBeDefined()
      expect(updatedCard!.status).toBe("done")
      expect(updatedCard!.verification).toEqual({ result: "Work completed", timestamp: expect.any(Number) })
    }),
  )

  it.instance("creates a verifier card and completes it", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const agent = (yield* agents.defaultInfo()).name
      const all = yield* registry.all()
      const kanbanSwarm = all.find((tool) => tool.id === "kanban-swarm")
      if (!kanbanSwarm) throw new Error("kanban-swarm tool not found")

      const kanbanTool = all.find((tool) => tool.id === "kanban")
      if (!kanbanTool) throw new Error("kanban tool not found")

      const boardResult = yield* kanbanTool.execute(
        { operation: "create_board", title: "Verifier board" },
        toolContext(agent),
      )
      const boardIdMatch = boardResult.output.match(/Board ([^\s]+)/)
      if (!boardIdMatch) throw new Error("Could not extract board ID")
      const boardId = boardIdMatch[1]

      const kanbanService = yield* Kanban.Service
      // Create a worker card first
      const workerCard = yield* kanbanService.createCard({
        boardId,
        rootSessionId: "test-root",
        title: "Worker task",
        status: "done",
      })

      // Create a verifier card linked to the worker
      const verifierCard = yield* kanbanService.createCard({
        boardId,
        rootSessionId: "test-root",
        title: "Verify worker output",
        parentId: workerCard.id,
      })

      // Complete the verifier
      const completeResult = yield* kanbanSwarm.execute(
        {
          operation: "complete_verifier",
          boardId,
          cardId: verifierCard.id,
          verification: { result: "Verification passed", timestamp: Date.now() },
        },
        toolContext(agent),
      )
      expect(completeResult.title).toContain("Completed verifier")
      expect(completeResult.output).toContain("Verify worker output")

      // Verify card status is updated to done
      const updatedCard = yield* kanbanService.getBoard(boardId).pipe(
        Effect.flatMap((_board) => kanbanService.listCards({ boardId })),
        Effect.map((cards) => cards.find((c) => c.id === verifierCard.id)),
      )
      expect(updatedCard).toBeDefined()
      expect(updatedCard!.status).toBe("done")
      expect(updatedCard!.verification).toEqual({ result: "Verification passed", timestamp: expect.any(Number) })
      expect(updatedCard!.parentId).toBe(workerCard.id)
    }),
  )

  itDepth.instance("create_worker fails when the session is at the subagent_depth_limit", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const kanbanSwarm = (yield* registry.all()).find((tool) => tool.id === "kanban-swarm")
      if (!kanbanSwarm) throw new Error("kanban-swarm tool not found")

      const chat = yield* sessions.create({ title: "root" })
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })

      const exit = yield* kanbanSwarm
        .execute(
          {
            operation: "create_worker",
            boardId: "board-1",
            title: "worker",
            prompt: "work",
            subagent_type: "explore",
          },
          {
            sessionID: child.id,
            messageID: MessageID.make("msg_kanban_swarm_depth"),
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(String(Cause.squash(exit.cause))).toContain("Subagent depth limit reached (1)")
      }
      expect(yield* sessions.children(chat.id)).toHaveLength(1)
    }),
  )
})
