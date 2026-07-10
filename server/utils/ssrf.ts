import { createError } from 'h3'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF guard. Rejects an http(s) URL whose host is — or resolves to — a
 * loopback / private / link-local / reserved address, so member-supplied
 * webhook and probe URLs can't reach internal services (including the cloud
 * metadata endpoint at 169.254.169.254).
 *
 * Level 1: validates the URL's host and its DNS resolution. It does NOT pin the
 * socket to the validated IP, so a hostname that re-resolves to a private
 * address between this check and the real fetch (DNS rebinding) is not covered
 * — a deliberate follow-up if the threat model ever needs it.
 */

function ipToLong(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const b = Number(p)
    if (b > 255) return null
    n = n * 256 + b
  }
  return n
}

function ipv4InCidr(ipLong: number, base: string, bits: number): boolean {
  const baseLong = ipToLong(base)
  if (baseLong === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipLong & mask) === (baseLong & mask)
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipToLong(ip)
  if (n === null) return true // unparseable → treat as unsafe
  return (
    ipv4InCidr(n, '0.0.0.0', 8) ||       // "this" network
    ipv4InCidr(n, '10.0.0.0', 8) ||      // RFC1918 private
    ipv4InCidr(n, '100.64.0.0', 10) ||   // CGNAT
    ipv4InCidr(n, '127.0.0.0', 8) ||     // loopback
    ipv4InCidr(n, '169.254.0.0', 16) ||  // link-local (cloud metadata)
    ipv4InCidr(n, '172.16.0.0', 12) ||   // RFC1918 private
    ipv4InCidr(n, '192.0.0.0', 24) ||    // IETF protocol assignments
    ipv4InCidr(n, '192.168.0.0', 16) ||  // RFC1918 private
    ipv4InCidr(n, '198.18.0.0', 15) ||   // benchmarking
    ipv4InCidr(n, '224.0.0.0', 4) ||     // multicast
    ipv4InCidr(n, '240.0.0.0', 4)        // reserved
  )
}

function isPrivateIPv6(ip: string): boolean {
  const a = ip.toLowerCase()
  if (a === '::1' || a === '::') return true
  if (a.startsWith('fc') || a.startsWith('fd')) return true // fc00::/7 unique-local
  if (/^fe[89ab]/.test(a)) return true // fe80::/10 link-local
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) // IPv4-mapped
  if (mapped) return isPrivateIPv4(mapped[1])
  return false
}

function isPrivateAddress(ip: string): boolean {
  const fam = isIP(ip)
  if (fam === 4) return isPrivateIPv4(ip)
  if (fam === 6) return isPrivateIPv6(ip)
  return true // not a recognizable IP → unsafe
}

function block(msg = 'URL host is not allowed'): never {
  throw createError({ statusCode: 400, statusMessage: msg })
}

/**
 * Throws a 400 unless the URL is http(s) and its host resolves only to public
 * addresses. Call at webhook save time and before every outbound fetch of a
 * user-influenced URL.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    block('Invalid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    block('URL must use http or https')
  }
  const host = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '')
  if (!host) block('Invalid URL host')

  // Literal IP — check directly, no DNS.
  if (isIP(host)) {
    if (isPrivateAddress(host)) block('URL host is a private or reserved address')
    return
  }

  // Obvious internal names — reject before spending a DNS lookup.
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    block()
  }

  let addrs: { address: string }[]
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    block(`Could not resolve URL host: ${host}`)
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    block('URL host resolves to a private or reserved address')
  }
}
