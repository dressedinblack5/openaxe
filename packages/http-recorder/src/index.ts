import { http } from "./effect.js"
import { socket } from "./socket.js"

/** HTTP and WebSocket cassette recording. */
export const HttpRecorder = { http, socket } as const

/** Additional JSON metadata stored with a cassette. */
export type { CassetteMetadata } from "./types.js"
/** Recorder configuration. */
export type { RecorderOptions } from "./types.js"
/** Additive redaction and header-preservation policy. */
export type { RedactOptions } from "./types.js"
/** Returns whether an incoming HTTP request matches a recorded request. */
export type { RequestMatcher } from "./types.js"
/** The normalized HTTP request representation used for matching. */
export type { RequestSnapshot } from "./types.js"
