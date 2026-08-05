import { Effect, Schema } from "effect"
import * as YAML from "yaml"
import path from "path"
import { ConfigTemplate } from "@opencode-ai/core/config/template"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV2 } from "@opencode-ai/core/session"
import { Permission } from "@/permission"
import { Session } from "./session"

export * as Template from "./template"

export const templatesDir = (directory: string) => path.join(directory, ".openaxe", "templates")

export class TemplateError extends Schema.TaggedErrorClass<TemplateError>()("SessionTemplateError", {
  message: Schema.String,
}) {}

export const listTemplates = (directory: string) =>
  Effect.gen(function* () {
    const dir = templatesDir(directory)
    const entries = yield* Effect.promise(async () => {
      const { readdir } = await import("node:fs/promises")
      try {
        return await readdir(dir)
      } catch {
        return [] as string[]
      }
    })
    return entries
      .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
      .map((name) => name.replace(/\.ya?ml$/, ""))
      .sort()
  })

export const loadTemplate = (directory: string, name: string) =>
  Effect.gen(function* () {
    const file = path.join(templatesDir(directory), `${name}.yaml`)
    if (!(yield* Effect.promise(() => Bun.file(file).exists()))) {
      return yield* new TemplateError({ message: `Template not found: ${name} (expected ${file})` })
    }
    const raw = yield* Effect.promise(() => Bun.file(file).text())
    let parsed: unknown
    try {
      parsed = YAML.parse(raw)
    } catch (err) {
      return yield* new TemplateError({
        message: `Invalid YAML in ${file}: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
    try {
      return Schema.decodeUnknownSync(ConfigTemplate.SessionTemplate)(parsed)
    } catch (err) {
      return yield* new TemplateError({
        message: `Invalid template ${name}: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  })

// "provider/model@variant" -> ModelV2.Ref
const modelRef = (input: string) => {
  const [ref, variant] = input.split("@")
  const { providerID, modelID } = ModelV2.parse(ref)
  return variant
    ? { id: modelID, providerID, variant: ModelV2.VariantID.make(variant) }
    : { id: modelID, providerID }
}

export const createFromTemplate = (input: { template: ConfigTemplate.SessionTemplate; directory: string }) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const v2 = yield* SessionV2.Service
    const t = input.template
    const info = yield* session.create({
      title: t.name,
      ...(t.agent === undefined ? {} : { agent: t.agent }),
      ...(t.model === undefined ? {} : { model: modelRef(t.model) }),
      ...(t.permissions === undefined ? {} : { permission: Permission.fromConfig(t.permissions) }),
      metadata: {
        template: t.name,
        ...(t.description === undefined ? {} : { description: t.description }),
        ...(t.systemPrompt === undefined ? {} : { systemPrompt: t.systemPrompt }),
        ...(t.mcp === undefined ? {} : { mcp: t.mcp }),
        ...(t.tools === undefined ? {} : { tools: t.tools }),
      },
    })
    for (const step of t.steps ?? []) {
      yield* v2
        .prompt({ sessionID: info.id, prompt: { text: step.prompt } })
        .pipe(
          Effect.mapError(
            () => new TemplateError({ message: `Failed to enqueue step "${step.name}" on session ${info.id}` }),
          ),
        )
      // ponytail: SessionV2.prompt has no per-prompt model hook; the session model governs the run
    }
    return info
  })
