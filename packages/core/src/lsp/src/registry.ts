// @ts-nocheck
import { HashMap } from "effect"
import { ServerDefinition, ServerRegistry } from "./types"
import { Filesystem } from "@opencode-ai/core/util/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { Process } from "@opencode-ai/core/util/process"
import { Module } from "@opencode-ai/core/util/module"
import path from "path"
import fs from "fs/promises"

/**
 * ServerRegistry - Hybrid factory for server definitions
 * Provides makeNpmServer, makeGoServer, makeCargoServer, makeBinaryServer, makeMasonServer
 */

const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

const _run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })

const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): ServerDefinition["root"] => {
  return async (file, ctx) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: ctx.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: ctx.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return ctx.directory
    return path.dirname(first.value)
  }
}

/**
 * Factory functions for common server patterns
 */

export const makeNpmServer = (input: {
  id: string
  name: string
  extensions: ReadonlyArray<string>
  package: string
  binary?: string
  args?: ReadonlyArray<string>
  rootPatterns?: ReadonlyArray<string>
  excludePatterns?: ReadonlyArray<string>
  initialization?: Record<string, unknown>
}): ServerDefinition => ({
  id: input.id,
  name: input.name,
  extensions: input.extensions,
  rootPatterns: input.rootPatterns,
  excludePatterns: input.excludePatterns,
  root: input.rootPatterns ? NearestRoot(input.rootPatterns, input.excludePatterns) : undefined,
  async spawn(root, ctx, flags) {
    const bin = input.binary ?? input.package
    const resolved = await Npm.which(bin)
    if (!resolved) {
      if (flags.disableLspDownload) return undefined
      const resolved2 = await Npm.which(input.package)
      if (!resolved2) return undefined
    }
    const finalBin = resolved ?? (await Npm.which(input.package))
    if (!finalBin) return undefined
    const args = input.args ?? ["--stdio"]
    return {
      process: Process.spawn(finalBin, args, {
        cwd: root,
        env: { ...process.env },
      }),
      initialization: input.initialization,
    }
  },
  initialization: input.initialization,
  downloadStrategy: { type: "npm", package: input.package, binary: input.binary },
})

export const makeGoServer = (input: {
  id: string
  name: string
  extensions: ReadonlyArray<string>
  module: string
  binary?: string
  args?: ReadonlyArray<string>
  rootPatterns?: ReadonlyArray<string>
  excludePatterns?: ReadonlyArray<string>
}): ServerDefinition => ({
  id: input.id,
  name: input.name,
  extensions: input.extensions,
  rootPatterns: input.rootPatterns,
  excludePatterns: input.excludePatterns,
  root: input.rootPatterns ? NearestRoot(input.rootPatterns, input.excludePatterns) : undefined,
  async spawn(root, _ctx, flags) {
    let bin = input.binary ?? input.name
    const whichResult = await output(["which", bin]).catch(() => ({ code: 1, text: "" }))
    if (whichResult.code !== 0) {
      if (flags.disableLspDownload) return undefined
      const proc = Process.spawn(["go", "install", `${input.module}@latest`], {
        env: { ...process.env, GOBIN: Global.Path.bin },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) return undefined
      bin = path.join(
        Global.Path.bin,
        input.binary ?? path.basename(input.module) + (process.platform === "win32" ? ".exe" : ""),
      )
    }
    const args = input.args ?? []
    return {
      process: Process.spawn(bin, args, { cwd: root }),
    }
  },
  downloadStrategy: { type: "go", module: input.module, binary: input.binary },
})

export const makeCargoServer = (input: {
  id: string
  name: string
  extensions: ReadonlyArray<string>
  crate: string
  binary?: string
  args?: ReadonlyArray<string>
  rootPatterns?: ReadonlyArray<string>
  excludePatterns?: ReadonlyArray<string>
}): ServerDefinition => ({
  id: input.id,
  name: input.name,
  extensions: input.extensions,
  rootPatterns: input.rootPatterns,
  excludePatterns: input.excludePatterns,
  root: input.rootPatterns ? NearestRoot(input.rootPatterns, input.excludePatterns) : undefined,
  async spawn(root, _ctx, flags) {
    let bin = input.binary ?? input.name
    const whichResult = await output(["which", bin]).catch(() => ({ code: 1, text: "" }))
    if (whichResult.code !== 0) {
      if (flags.disableLspDownload) return undefined
      const proc = Process.spawn(["cargo", "install", input.crate, "--locked"], {
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) return undefined
      bin = path.join(Global.Path.bin, input.binary ?? input.name + (process.platform === "win32" ? ".exe" : ""))
    }
    const args = input.args ?? []
    return {
      process: Process.spawn(bin, args, { cwd: root }),
    }
  },
  downloadStrategy: { type: "cargo", crate: input.crate, binary: input.binary },
})

export const makeBinaryServer = (input: {
  id: string
  name: string
  extensions: ReadonlyArray<string>
  binary: string
  args?: ReadonlyArray<string>
  rootPatterns?: ReadonlyArray<string>
  excludePatterns?: ReadonlyArray<string>
  url?: string
  archiveType?: "zip" | "tar.gz" | "tar.xz"
}): ServerDefinition => ({
  id: input.id,
  name: input.name,
  extensions: input.extensions,
  rootPatterns: input.rootPatterns,
  excludePatterns: input.excludePatterns,
  root: input.rootPatterns ? NearestRoot(input.rootPatterns, input.excludePatterns) : undefined,
  async spawn(root, _ctx, flags) {
    const localBin = path.join(root, "node_modules", ".bin", input.binary)
    if (await pathExists(localBin)) {
      return {
        process: Process.spawn(localBin, input.args ?? [], { cwd: root }),
      }
    }
    const found = await output(["which", input.binary]).catch(() => ({ code: 1, text: "" }))
    if (found.code === 0) {
      return {
        process: Process.spawn(found.text.trim(), input.args ?? [], { cwd: root }),
      }
    }
    if (input.url && !flags.disableLspDownload) {
      // Would download and extract
      return undefined
    }
    return undefined
  },
  downloadStrategy: input.url
    ? { type: "binary", url: input.url, binary: input.binary, archiveType: input.archiveType }
    : undefined,
})

export const makeMasonServer = (input: {
  id: string
  name: string
  extensions: ReadonlyArray<string>
  package: string
  binary?: string
  args?: ReadonlyArray<string>
  rootPatterns?: ReadonlyArray<string>
  excludePatterns?: ReadonlyArray<string>
}): ServerDefinition => ({
  id: input.id,
  name: input.name,
  extensions: input.extensions,
  rootPatterns: input.rootPatterns,
  excludePatterns: input.excludePatterns,
  root: input.rootPatterns ? NearestRoot(input.rootPatterns, input.excludePatterns) : undefined,
  async spawn(root, _ctx, flags) {
    const masonBin = path.join(Global.Path.bin, "mason")
    if (!(await pathExists(masonBin))) {
      if (flags.disableLspDownload) return undefined
      // Would install mason
      return undefined
    }
    return {
      process: Process.spawn(masonBin, ["exec", input.package, ...(input.args ?? [])], { cwd: root }),
    }
  },
  downloadStrategy: { type: "mason", package: input.package, binary: input.binary },
})

/**
 * Built-in server definitions using factories
 */

export const BuiltinServers: ReadonlyArray<ServerDefinition> = [
  {
    id: "typescript",
    name: "TypeScript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    root: NearestRoot(
      ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
      ["deno.json", "deno.jsonc"],
    ),
    async spawn(root, ctx) {
      const tsserver = Module.resolve("typescript/lib/tsserver.js", ctx.directory)
      if (!tsserver) return undefined
      const bin = await Npm.which("typescript-language-server")
      if (!bin) return undefined
      return {
        process: Process.spawn(bin, ["--stdio"], { cwd: root }),
        initialization: { tsserver: { path: tsserver } },
      }
    },
    initialization: { tsserver: { path: "" } },
  },
  makeNpmServer({
    id: "eslint",
    name: "ESLint",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
    package: "vscode-eslint",
    binary: "eslintServer.js",
    rootPatterns: ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
    initialization: {},
  }),
  makeNpmServer({
    id: "oxlint",
    name: "Oxlint",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"],
    package: "oxlint",
    binary: "oxc_language_server",
    rootPatterns: [
      ".oxlintrc.json",
      "package-lock.json",
      "bun.lockb",
      "bun.lock",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package.json",
    ],
  }),
  makeNpmServer({
    id: "biome",
    name: "Biome",
    extensions: [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".mts",
      ".cts",
      ".json",
      ".jsonc",
      ".vue",
      ".astro",
      ".svelte",
      ".css",
      ".graphql",
      ".gql",
      ".html",
    ],
    package: "biome",
    binary: "biome",
    args: ["lsp-proxy", "--stdio"],
    rootPatterns: [
      "biome.json",
      "biome.jsonc",
      "package-lock.json",
      "bun.lockb",
      "bun.lock",
      "pnpm-lock.yaml",
      "yarn.lock",
    ],
  }),
  makeGoServer({
    id: "gopls",
    name: "gopls",
    extensions: [".go"],
    module: "golang.org/x/tools/gopls",
    rootPatterns: ["go.work", "go.mod", "go.sum"],
  }),
  makeGoServer({
    id: "rubocop",
    name: "Rubocop",
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    module: "rubocop",
    binary: "rubocop",
    args: ["--lsp"],
    rootPatterns: ["Gemfile"],
  }),
  makeNpmServer({
    id: "pyright",
    name: "Pyright",
    extensions: [".py", ".pyi"],
    package: "pyright",
    binary: "pyright-langserver",
    args: ["--stdio"],
    rootPatterns: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"],
  }),
  makeBinaryServer({
    id: "elixir-ls",
    name: "Elixir LS",
    extensions: [".ex", ".exs"],
    binary: "elixir-ls",
    rootPatterns: ["mix.exs", "mix.lock"],
    url: "https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip",
    archiveType: "zip",
  }),
  makeBinaryServer({
    id: "zls",
    name: "ZLS",
    extensions: [".zig", ".zon"],
    binary: "zls",
    rootPatterns: ["build.zig"],
    url: "https://github.com/zigtools/zls/releases/latest",
    archiveType: "tar.xz",
  }),
  makeBinaryServer({
    id: "clangd",
    name: "clangd",
    extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
    binary: "clangd",
    args: ["--background-index", "--clang-tidy"],
    rootPatterns: ["compile_commands.json", "compile_flags.txt", ".clangd"],
    url: "https://github.com/clangd/clangd/releases/latest",
    archiveType: "zip",
  }),
  makeNpmServer({
    id: "svelte",
    name: "Svelte",
    extensions: [".svelte"],
    package: "svelte-language-server",
    binary: "svelteserver",
    args: ["--stdio"],
    rootPatterns: ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
  }),
  makeNpmServer({
    id: "astro",
    name: "Astro",
    extensions: [".astro"],
    package: "@astrojs/language-server",
    binary: "astro-ls",
    args: ["--stdio"],
    rootPatterns: ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
    initialization: {},
  }),
  makeBinaryServer({
    id: "dart",
    name: "Dart",
    extensions: [".dart"],
    binary: "dart",
    args: ["language-server", "--lsp"],
    rootPatterns: ["pubspec.yaml", "analysis_options.yaml"],
  }),
  makeBinaryServer({
    id: "ocaml-lsp",
    name: "OCaml LSP",
    extensions: [".ml", ".mli"],
    binary: "ocamllsp",
    rootPatterns: ["dune-project", "dune-workspace", ".merlin", "opam"],
  }),
  makeBinaryServer({
    id: "bash",
    name: "Bash",
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
    binary: "bash-language-server",
    args: ["start"],
    root: () => Promise.resolve(undefined), // Uses directory
  }),
  makeBinaryServer({
    id: "terraform",
    name: "Terraform",
    extensions: [".tf", ".tfvars"],
    binary: "terraform-ls",
    args: ["serve"],
    rootPatterns: [".terraform.lock.hcl", "terraform.tfstate", "*.tf"],
    initialization: {
      experimentalFeatures: {
        prefillRequiredFields: true,
        validateOnSave: true,
      },
    },
  }),
  makeBinaryServer({
    id: "texlab",
    name: "texlab",
    extensions: [".tex", ".bib"],
    binary: "texlab",
    rootPatterns: [".latexmkrc", "latexmkrc", ".texlabroot", "texlabroot"],
    url: "https://github.com/latex-lsp/texlab/releases/latest",
    archiveType: "tar.gz",
  }),
  makeNpmServer({
    id: "dockerfile",
    name: "Dockerfile",
    extensions: [".dockerfile", "Dockerfile"],
    package: "dockerfile-language-server-nodejs",
    binary: "docker-langserver",
    args: ["--stdio"],
    root: () => Promise.resolve(undefined),
  }),
  makeBinaryServer({
    id: "gleam",
    name: "Gleam",
    extensions: [".gleam"],
    binary: "gleam",
    args: ["lsp"],
    rootPatterns: ["gleam.toml"],
  }),
  makeBinaryServer({
    id: "clojure-lsp",
    name: "Clojure LSP",
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
    binary: "clojure-lsp",
    args: ["listen"],
    rootPatterns: ["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"],
  }),
  makeBinaryServer({
    id: "nixd",
    name: "nixd",
    extensions: [".nix"],
    binary: "nixd",
    rootPatterns: ["flake.nix"],
  }),
]

/**
 * ServerRegistry implementation
 */

export const makeServerRegistry = (initialServers: ReadonlyArray<ServerDefinition> = []): ServerRegistry => {
  let servers = new HashMap.HashMap<string, ServerDefinition>()
  for (const server of initialServers) {
    servers = HashMap.set(servers, server.id, server)
  }

  return {
    getAll(): ReadonlyArray<ServerDefinition> {
      return HashMap.values(servers)
    },
    getById(id: string): ServerDefinition | undefined {
      return HashMap.get(servers, id)
    },
    getByExtension(ext: string): ReadonlyArray<ServerDefinition> {
      return HashMap.values(servers).filter((server) => server.extensions.includes(ext))
    },
    register(definition: ServerDefinition): void {
      servers = HashMap.set(servers, definition.id, definition)
    },
    unregister(id: string): void {
      servers = HashMap.remove(servers, id)
    },
  }
}

/**
 * Service
 */

export class ServerRegistryService extends Context.Tag("ServerRegistryService")<
  ServerRegistryService,
  ServerRegistry
>() {}

export const ServerRegistryLive = Layer.succeed(ServerRegistryService, makeServerRegistry())

export * as Registry from "./registry"
