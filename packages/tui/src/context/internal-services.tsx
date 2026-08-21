import { createSimpleContext } from "./helper"
import type { ArtifactEntry, ArtifactSummary } from "@opencode-ai/core/artifact"

export interface InternalServices {
  artifact: {
    list: (keyPrefix?: string) => Promise<Array<ArtifactSummary>>
    get: (key: string, version?: number) => Promise<ArtifactEntry | null>
    store: (key: string, content: string) => Promise<ArtifactEntry>
  }
  memory: {
    list: (kind?: string, scope?: string, source?: string) => Promise<Array<{ key: string; value: unknown; kind: string; scope: string; source: string }>>
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown, kind?: string, scope?: string, source?: string) => Promise<void>
    remove: (key: string) => Promise<void>
  }
}

export const { use: useInternalServices, provider: InternalServicesProvider } = createSimpleContext({
  name: "InternalServices",
  init: (props: { services: InternalServices }) => {
    return props.services
  },
})