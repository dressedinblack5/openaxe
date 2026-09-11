export const PTY_CONNECT_TOKEN_HEADER = "x-opencode-ticket"

const PTY_CONNECT_PATH = /^\/pty\/[^/]+\/connect$/

export function isPtyConnectPath(pathname: string) {
  return PTY_CONNECT_PATH.test(pathname)
}

// Check for header-only ticket (query param removed)
export function hasPtyConnectTicketHeader(headers: Record<string, string | undefined>) {
  return headers[PTY_CONNECT_TOKEN_HEADER] !== undefined
}
