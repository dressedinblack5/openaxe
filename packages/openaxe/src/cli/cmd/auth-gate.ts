import { Flag } from "@opencode-ai/core/flag/flag"

export const SERVER_AUTH_REQUIRED_MESSAGE =
  "Server requires authentication. Set OPENCODE_SERVER_PASSWORD or use --no-auth (DANGEROUS - only for trusted networks)."
export const SERVER_NO_AUTH_WARNING =
  "WARNING: Server starting WITHOUT authentication. This exposes the API to anyone on the network!"

export type ServerAuthArgs = {
  "no-auth"?: unknown
  auth?: unknown
}

export function resolveServerAuth(args: ServerAuthArgs) {
  const hasPassword = !!Flag.OPENCODE_SERVER_PASSWORD
  const noAuth = args["no-auth"] === true || args.auth === false
  return { hasPassword, noAuth }
}
