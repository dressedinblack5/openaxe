import { Effect } from "effect"

const PRIVATE_IP_RANGES = [
  { start: ipToInt("10.0.0.0"), end: ipToInt("10.255.255.255") },
  { start: ipToInt("172.16.0.0"), end: ipToInt("172.31.255.255") },
  { start: ipToInt("192.168.0.0"), end: ipToInt("192.168.255.255") },
  { start: ipToInt("127.0.0.0"), end: ipToInt("127.255.255.255") },
  { start: ipToInt("169.254.0.0"), end: ipToInt("169.254.255.255") },
  { start: ipToInt("::1"), end: ipToInt("::1") },
  { start: ipToInt("fe80::"), end: ipToInt("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff") },
  { start: ipToInt("fc00::"), end: ipToInt("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff") },
]

const ALLOWED_SCHEMES = new Set(["https:", "http:"])

function ipToInt(ip: string): bigint {
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
  return import("dns/promises")
    .then((dns) => new dns.Resolver().resolve4(hostname))
    .catch(() => [])
}

function isPrivateIp(ip: string): boolean {
  const ipInt = ipToInt(ip)
  return PRIVATE_IP_RANGES.some((range) => ipInt >= range.start && ipInt <= range.end)
}

export interface SafeFetchOptions {
  allowedSchemes?: Set<string>
  allowPrivateIps?: boolean
  timeoutMs?: number
  maxRedirects?: number
}

const DEFAULT_OPTIONS: Required<SafeFetchOptions> = {
  allowedSchemes: ALLOWED_SCHEMES,
  allowPrivateIps: false,
  timeoutMs: 30_000,
  maxRedirects: 0,
}

export async function safeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: SafeFetchOptions,
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url)

  if (!opts.allowedSchemes.has(url.protocol)) {
    throw new Error(`Scheme ${url.protocol} not allowed. Allowed: ${Array.from(opts.allowedSchemes).join(", ")}`)
  }

  const hostname = url.hostname
  const ips = await resolveHostname(hostname)
  ips.forEach((ip) => {
    if (isPrivateIp(ip) && !opts.allowPrivateIps) {
      throw new Error(`Access to private IP range blocked: ${ip}`)
    }
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: opts.maxRedirects === 0 ? "error" : "follow",
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

export function createSafeFetch(options?: SafeFetchOptions) {
  return (input: RequestInfo | URL, init?: RequestInit) => safeFetch(input, init, options)
}

export * as SafeFetch from "./safe-fetch"