import { NodeFileSystem, NodeHttpClient, NodePath } from "@effect/platform-node"
import { LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { LayerNode } from "./layer-node"

const keepAliveAgents = LayerNode.make(
  NodeHttpClient.layerAgentOptions({
    keepAlive: true,
    maxSockets: 50,
    keepAliveMsecs: 60_000,
    timeout: 30_000,
  }),
  [],
)

export const filesystem = LayerNode.make(NodeFileSystem.layer, [])
export const path = LayerNode.make(NodePath.layer, [])
export const httpClient = LayerNode.make(NodeHttpClient.layerNodeHttpNoAgent, [keepAliveAgents])
export const requestExecutor = LayerNode.make(RequestExecutor.layer, [httpClient])
export const llmClient = LayerNode.make(LLMClient.layer, [requestExecutor])

export * as LayerNodePlatform from "./layer-node-platform"
