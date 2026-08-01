import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import type { Hooks } from "./registration.js"

export type AISDKHooks = Hooks<{
  sdk: {
    readonly model: ModelV2Info
    readonly package: string
    // oxlint-disable-next-line typescript-eslint/no-explicit-any -- dynamic AI-SDK provider contract: options blobs are spread/indexed by consumers and flow into provider constructors.
    readonly options: Record<string, any>
    // oxlint-disable-next-line typescript-eslint/no-explicit-any -- dynamic AI-SDK provider instance: no shared interface covers the union of provider surfaces (responses/chat/languageModel/workflowChat/agenticChat).
    sdk?: any
  }
  language: {
    readonly model: ModelV2Info
    // oxlint-disable-next-line typescript-eslint/no-explicit-any -- dynamic AI-SDK provider instance: no shared interface covers the union of provider surfaces (responses/chat/languageModel/workflowChat/agenticChat).
    readonly sdk: any
    // oxlint-disable-next-line typescript-eslint/no-explicit-any -- dynamic AI-SDK provider contract: options blobs are spread/indexed by consumers and flow into provider constructors.
    readonly options: Record<string, any>
    language?: LanguageModelV3
  }
}>
