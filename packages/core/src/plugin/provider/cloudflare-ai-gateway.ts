import os from "node:os"
import { InstallationVersion } from "../../installation/version"
import { Effect, Option, Schema } from "effect"
import { define } from "../internal"

export const CloudflareAIGatewayPlugin = define({
  id: "cloudflare-ai-gateway",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "ai-gateway-provider") return
        if (evt.options.baseURL) return

        const config = gatewayConfig(evt.options)
        if (!config) return
        const metadata = gatewayMetadata(evt.options)
        const { createAiGateway } = yield* Effect.promise( async () => import("ai-gateway-provider")).pipe(Effect.orDie)
        const { createUnified } = yield* Effect.promise( async () => import("ai-gateway-provider/providers/unified")).pipe(
          Effect.orDie,
        )
        const gateway = createAiGateway({
          accountId: config.accountId,
          gateway: config.gatewayId,
          apiKey: config.apiKey,
          options: gatewayOptions(evt.options, metadata),
        })
        const unified = createUnified({ apiKey: config.apiKey })
        evt.sdk = {
          languageModel(modelID: string) {
            return gateway(unified(modelID))
          },
        }
      }),
    )
  }),
})

type GatewayConfig = {
  accountId: string
  gatewayId: string
  apiKey: string
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function gatewayConfig(options: Record<string, unknown>): GatewayConfig | undefined {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
  // Credential projection copies key metadata into options. The prompt stores the
  // gateway as gatewayId, while older config examples may use gateway.
  const gatewayId =
    process.env.CLOUDFLARE_GATEWAY_ID ?? stringOption(options, "gatewayId") ?? stringOption(options, "gateway")
  const apiKey = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_AIG_TOKEN ?? stringOption(options, "apiKey")
  if (!accountId || !gatewayId || !apiKey) return undefined

  return { accountId, gatewayId, apiKey }
}

function gatewayMetadata(options: Record<string, unknown>) {
  // Preserve the legacy cf-aig-metadata header escape hatch for gateway logging
  // metadata, but prefer the typed metadata option when present.
  if (options.metadata !== undefined) return options.metadata
  const headers = options.headers
  const raw =
    typeof headers === "object" && headers !== null && !Array.isArray(headers) && "cf-aig-metadata" in headers
      ? headers["cf-aig-metadata"]
      : undefined
  return typeof raw === "string" ? Option.getOrUndefined(decodeJson(raw)) : undefined
}

function gatewayOptions(options: Record<string, unknown>, metadata: unknown) {
  return {
    metadata: isMetadata(metadata) ? metadata : undefined,
    cacheTtl: typeof options.cacheTtl === "number" ? options.cacheTtl : undefined,
    cacheKey: typeof options.cacheKey === "string" ? options.cacheKey : undefined,
    skipCache: typeof options.skipCache === "boolean" ? options.skipCache : undefined,
    collectLog: typeof options.collectLog === "boolean" ? options.collectLog : undefined,
    headers: {
      "User-Agent": `opencode/${InstallationVersion} cloudflare-ai-gateway (${os.platform()} ${os.release()}; ${os.arch()})`,
    },
  }
}

function stringOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "string" ? options[key] : undefined
}

const isJsonPrimitive = (value: unknown): value is number | string | boolean | null | bigint =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  typeof value === "bigint"

const isMetadata = (value: unknown): value is Record<string, number | string | boolean | null | bigint> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(isJsonPrimitive)
