import { Schema } from "effect"

export const PRIVATE_IP_RANGES = [
  { start: ipToInt("10.0.0.0"), end: ipToInt("10.255.255.255") },
  { start: ipToInt("172.16.0.0"), end: ipToInt("172.31.255.255") },
  { start: ipToInt("192.168.0.0"), end: ipToInt("192.168.255.255") },
  { start: ipToInt("127.0.0.0"), end: ipToInt("127.255.255.255") },
  { start: ipToInt("169.254.0.0"), end: ipToInt("169.254.255.255") },
  { start: ipToInt("::1"), end: ipToInt("::1") },
  { start: ipToInt("fe80::"), end: ipToInt("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff") },
  { start: ipToInt("fc00::"), end: ipToInt("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff") },
] as const

export const ALLOWED_SCHEMES = new Set(["http:", "https:"])

export function ipToInt(ip: string): bigint {
  if (ip.includes(":")) {
    const parts = ip.split(":")
    let result = 0n
    for (const part of parts) {
      result = (result << 16n) | BigInt(parseInt(part || "0", 16))
    }
    return result
  }
  return ip.split(".").reduce((acc, octet) => (acc << 8n) | BigInt(parseInt(octet, 10)), 0n)
}

async function resolveHostname(hostname: string): Promise<string[]> {
  try {
    const { Resolver } = await import("dns/promises")
    const resolver = new Resolver()
    return await resolver.resolve4(hostname)
  } catch {
    return []
  }
}

export function isPrivateIp(ip: string): boolean {
  const ipInt = ipToInt(ip)
  return PRIVATE_IP_RANGES.some((range) => ipInt >= range.start && ipInt <= range.end)
}

export function validateMcpUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid MCP URL: ${url}`)
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(`MCP URL scheme not allowed: ${parsed.protocol}. Only http: and https: are permitted.`)
  }
  return parsed
}

export async function validateMcpUrlSafe(url: string): Promise<void> {
  const parsed = validateMcpUrl(url)
  const hostname = parsed.hostname
  const ips = await resolveHostname(hostname)
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new Error(`Access to private IP range blocked: ${ip}`)
    }
  }
}

export function validateMcpUrlSync(url: string): URL {
  return validateMcpUrl(url)
}

export function createRemoteUrlSchema() {
  return Schema.String
}

export type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled?: boolean
  headers?: Record<string, string>
  oauth?: {
    clientId?: string
    clientSecret?: string
    scope?: string
    callbackPort?: number
    redirectUri?: string
  } | false
  timeout?: number
}