import { Effect, Layer } from "effect"
import { describe, it, expect } from "bun:test"
import { ToolRegistryLive } from "../src/registry"
import { AvailabilityLive } from "../src/availability"
import { Schema } from "effect"
import { CoreToolAdapterLayer } from "../src/adapters/core-tool"
import { CliToolAdapterLayer } from "../src/adapters/cli-tool"
import { PluginToolAdapterLayer } from "../src/adapters/plugin-tool"
import { SessionID, MessageID } from "@opencode-ai/core/session/schema"
import z from "zod"

// Test schemas
const TestInputSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.Number,
})

const TestOutputSchema = Schema.Struct({
  result: Schema.String,
})

type TestInput = Schema.Schema.Type<typeof TestInputSchema>

// Mock context
const _mockBaseContext = {
  sessionID: "test-session" as SessionID,
  messageID: "test-message" as MessageID,
  agent: "test-agent",
  abort: new AbortSignal(),
  callID: "test-call",
  extra: {},
}

describe("Adapter Harness - Strangler Fig Pattern", () => {
  describe("Core Adapter", () => {
    it("should re-export core types and functions", () => {
      // Verify exports exist
      expect(CoreToolAdapterLayer.make).toBeDefined()
      expect(CoreToolAdapterLayer.validateName).toBeDefined()
      expect(CoreToolAdapterLayer.withPermission).toBeDefined()
      expect(CoreToolAdapterLayer.definition).toBeDefined()
      expect(CoreToolAdapterLayer.settle).toBeDefined()
      expect(CoreToolAdapterLayer.permission).toBeDefined()
      expect(CoreToolAdapterLayer.maxResultSizeChars).toBeDefined()
      expect(CoreToolAdapterLayer.subagentSafe).toBeDefined()
      expect(CoreToolAdapterLayer.isAvailable).toBeDefined()
      expect(CoreToolAdapterLayer.describe).toBeDefined()
      expect(CoreToolAdapterLayer.toCoreTool).toBeDefined()
      expect(CoreToolAdapterLayer.fromCoreTool).toBeDefined()
    })

    it("should convert unified tool to core tool and back", () => {
      const unified = CoreToolAdapterLayer.make({
        id: "core_adapter_test",
        description: "Core adapter test",
        parameters: TestInputSchema,
        output: TestOutputSchema,
        execute: async (_input: TestInput) => ({ result: "ok" }),
      })

      const core = CoreToolAdapterLayer.toCoreTool(unified)
      expect(core.id).toBe("core_adapter_test")

      const back = CoreToolAdapterLayer.fromCoreTool(core)
      expect(back.id).toBe("core_adapter_test")
    })
  })

  describe("CLI Adapter", () => {
    it("should re-export CLI types and functions", () => {
      expect(CliToolAdapterLayer.make).toBeDefined()
      expect(CliToolAdapterLayer.toCliTool).toBeDefined()
      expect(CliToolAdapterLayer.fromCliTool).toBeDefined()
      expect(CliToolAdapterLayer.checkCliAvailability).toBeDefined()
      expect(CliToolAdapterLayer.getCliDescription).toBeDefined()
      expect(CliToolAdapterLayer.settle).toBeDefined()
    })

    it("should convert unified tool to CLI tool", () => {
      const unified = CliToolAdapterLayer.make({
        id: "cli_adapter_test",
        description: "CLI adapter test",
        parameters: TestInputSchema,
        output: TestOutputSchema,
        execute: async (_input: TestInput) => ({
          title: "Test",
          metadata: {},
          output: "result",
          attachments: [],
        }),
      })

      const cli = CliToolAdapterLayer.toCliTool(unified)
      expect(cli.id).toBe("cli_adapter_test")
      expect(typeof cli.execute).toBe("function")
    })

    it("should check CLI availability", () => {
      const cli = CliToolAdapterLayer.make({
        id: "cli_avail_test",
        description: "CLI availability test",
        parameters: TestInputSchema,
        output: TestOutputSchema,
        execute: async (_input: TestInput) => ({
          title: "",
          metadata: {},
          output: "ok",
          attachments: [],
        }),
        availability: (input) => input.flags.allowCli === true,
      })

      const model = {
        providerID: "anthropic",
        modelID: "claude-3",
        agent: { id: "agent-1", name: "Test" },
      }

      expect(CliToolAdapterLayer.checkCliAvailability(cli, model, { allowCli: true })).toBe(true)
      expect(CliToolAdapterLayer.checkCliAvailability(cli, model, { allowCli: false })).toBe(false)
    })
  })

  describe("Plugin Adapter", () => {
    it("should re-export plugin types and functions", () => {
      expect(PluginToolAdapterLayer.fromZodTool).toBeDefined()
      expect(PluginToolAdapterLayer.toZodTool).toBeDefined()
      expect(PluginToolAdapterLayer.settle).toBeDefined()
      expect(PluginToolAdapterLayer.isAvailable).toBeDefined()
    })

    it("should convert Zod tool to unified tool", () => {
      const zodSchema = z.object({
        name: z.string(),
        value: z.number(),
      })

      const zodTool = {
        id: "plugin_adapter_test",
        description: "Plugin adapter test",
        args: { name: z.string(), value: z.number() },
        execute: async (args: z.infer<typeof zodSchema>) => ({ result: `Hello ${args.name}` }),
      }

      const unified = PluginToolAdapterLayer.fromZodTool(zodTool)
      expect(unified.id).toBe("plugin_adapter_test")
      expect(unified.description).toBe("Plugin adapter test")
    })

    it("should convert unified tool to Zod-compatible definition", () => {
      const unified = PluginToolAdapterLayer.fromZodTool({
        id: "to_zod_test",
        description: "To Zod test",
        args: { name: z.string(), value: z.number() },
        execute: async (_args: unknown) => ({ result: "ok" }),
      })

      const zodTool = PluginToolAdapterLayer.toZodTool(unified)
      expect(zodTool.id).toBe("to_zod_test")
      expect(typeof zodTool.execute).toBe("function")
    })
  })

  describe("Cross-adapter compatibility", () => {
    it("should maintain tool identity through adapter chain", () => {
      // Create unified tool
      const unified = CoreToolAdapterLayer.make({
        id: "chain_test",
        description: "Chain test",
        parameters: TestInputSchema,
        output: TestOutputSchema,
        execute: async (_input: TestInput) => ({ result: "ok" }),
      })

      // Convert to core and back
      const core = CoreToolAdapterLayer.toCoreTool(unified)
      const back1 = CoreToolAdapterLayer.fromCoreTool(core)

      // Convert to CLI and back
      const cli = CliToolAdapterLayer.toCliTool(unified)
      const back2 = CliToolAdapterLayer.fromCliTool(cli)

      // All should have same ID
      expect(back1.id).toBe("chain_test")
      expect(back2.id).toBe("chain_test")
    })

    it("should work with ToolRegistry through adapters", async () => {
      const registry = await Effect.runPromise(
        ToolRegistryLive.pipe(Layer.provide(AvailabilityLive))
      )

      // Register via core adapter
      const unified = CoreToolAdapterLayer.make({
        id: "registry_adapter_test",
        description: "Registry adapter test",
        parameters: TestInputSchema,
        output: TestOutputSchema,
        execute: async (_input: TestInput) => ({ result: "ok" }),
      })

      await Effect.runPromise(registry.register(unified))

      // Retrieve and verify
      const retrieved = await Effect.runPromise(registry.get("registry_adapter_test"))
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe("registry_adapter_test")
    })
  })
})