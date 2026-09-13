import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, TestInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import { DiscoveryCache } from "@/tool/discovery-cache"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".openaxe")])),
})

const root = LayerNode.group([ToolRegistry.node, Agent.node])
const replacements = [LayerNode.replace(Config.node, configLayer)]

const it = testEffect(LayerNode.buildLayer(root, { replacements }))

afterEach(async () => {
  await disposeAllInstances()
})

const cacheFile = path.join(Global.Path.state, "tool-discovery-cache.json")

async function writeToolFile(dir: string, name: string, description: string) {
  const toolDir = path.join(dir, ".openaxe", "tool")
  await fs.mkdir(toolDir, { recursive: true })
  await Bun.write(
    path.join(toolDir, name),
    [
      `export default {`,
      `  description: '${description}',`,
      `  args: {},`,
      `  execute: async () => {`,
      `    return '${description}'`,
      `  },`,
      `}`,
      ``,
    ].join("\n"),
  )
}

async function writeNonToolFile(dir: string, name: string) {
  const toolDir = path.join(dir, ".openaxe", "tool")
  await fs.mkdir(toolDir, { recursive: true })
  await Bun.write(path.join(toolDir, name), "export const notATool = 42\n")
}

describe("tool.registry discovery cache integration", () => {
  it.instance("cold run discovers and registers a custom tool, then persists the cache", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeToolFile(test.directory, "alpha.ts", "alpha description"))
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("alpha")

      const raw = yield* Effect.promise(() => fs.readFile(cacheFile, "utf8").catch(() => ""))
      const store = JSON.parse(raw) as DiscoveryCache.CacheStore
      expect(store.version).toBe(DiscoveryCache.emptyStore().version)
      const dir = path.join(test.directory, ".openaxe")
      expect(store.dirs[dir]).toBeDefined()
      expect(store.dirs[dir]?.files[path.join(dir, "tool", "alpha.ts")]?.exports).toEqual(["default"])
    }),
  )

  it.instance("caches a non-tool file with empty exports so warm runs skip importing it", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeToolFile(test.directory, "alpha.ts", "alpha description"))
      yield* Effect.promise(() => writeNonToolFile(test.directory, "helper.ts"))
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("alpha")
      expect(ids).not.toContain("helper")

      const raw = yield* Effect.promise(() => fs.readFile(cacheFile, "utf8").catch(() => ""))
      const store = JSON.parse(raw) as DiscoveryCache.CacheStore
      const dir = path.join(test.directory, ".openaxe")
      expect(store.dirs[dir]?.files[path.join(dir, "tool", "helper.ts")]?.exports).toEqual([])
      expect(store.dirs[dir]?.files[path.join(dir, "tool", "alpha.ts")]?.exports).toEqual(["default"])
    }),
  )

  it.instance("tolerates a corrupt cache file by falling back to a cold scan", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeToolFile(test.directory, "alpha.ts", "alpha description"))

      yield* Effect.promise(() => fs.mkdir(path.dirname(cacheFile), { recursive: true }))
      yield* Effect.promise(() => Bun.write(cacheFile, "{ this is not valid json !!!"))

      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("alpha")
    }),
  )
})

describe("DiscoveryCache module", () => {
  describe("statPath / sameSignature", () => {
    test("returns undefined for a missing path", () => {
      expect(DiscoveryCache.statPath("/definitely/not/here")).toBeUndefined()
    })

    test("returns a stable mtimeNs+size signature for an existing file", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "sig.txt")
      await fs.writeFile(file, "hello")
      const a = DiscoveryCache.statPath(file)
      const b = DiscoveryCache.statPath(file)
      expect(a).toBeDefined()
      expect(DiscoveryCache.sameSignature(a!, b!)).toBe(true)
    })

    test("detects a size change as a different signature", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "sig.txt")
      await fs.writeFile(file, "hello")
      const a = DiscoveryCache.statPath(file)
      await fs.writeFile(file, "hello world")
      const b = DiscoveryCache.statPath(file)
      expect(DiscoveryCache.sameSignature(a!, b!)).toBe(false)
    })
  })

  describe("sameSubdirs", () => {
    test("treats a missing key and an explicitly-undefined value as equal", () => {
      expect(DiscoveryCache.sameSubdirs({ tool: undefined as any }, {} as any)).toBe(true)
    })

    test("returns false when a subdir signature differs", () => {
      const sig = { mtimeNs: "123", size: 4 }
      expect(DiscoveryCache.sameSubdirs({ tool: sig }, { tool: { mtimeNs: "124", size: 4 } })).toBe(false)
    })
  })

  describe("isValidStore", () => {
    test("rejects non-objects and wrong versions", () => {
      expect(DiscoveryCache.isValidStore(null)).toBe(false)
      expect(DiscoveryCache.isValidStore(42)).toBe(false)
      expect(DiscoveryCache.isValidStore({ version: 99, dirs: {} })).toBe(false)
      expect(DiscoveryCache.isValidStore({ version: DiscoveryCache.emptyStore().version, dirs: {} })).toBe(true)
    })

    test("rejects malformed dir entries", () => {
      expect(
        DiscoveryCache.isValidStore({
          version: DiscoveryCache.emptyStore().version,
          dirs: { "/x": { subdirs: null, files: {} } },
        }),
      ).toBe(false)
    })
  })
})
