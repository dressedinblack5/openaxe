export * as SessionSchema from "./schema"

import { Session } from "@opencode-ai/schema/session"
import { SessionID } from "@opencode-ai/schema"
import type { MessageID } from "@opencode-ai/schema"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Session.Info
export type Info = Session.Info

export { SessionID }
export type { MessageID }
