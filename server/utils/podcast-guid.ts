import { createHash } from 'crypto'

// Podcast Namespace v5 UUID namespace, per
// https://github.com/Podcastindex-org/podcast-namespace/blob/main/proposal-docs/guid/guid.md
const PODCAST_NS_UUID = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6'

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function uuidv5(name: string, namespace: string): string {
  const hash = createHash('sha1')
  hash.update(uuidToBytes(namespace))
  hash.update(name)
  const bytes = hash.digest().subarray(0, 16)
  // Set version to 5 and variant to RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return bytesToUuid(bytes)
}

/**
 * Compute a Podcasting 2.0 channel GUID from a feed URL.
 * Strips the protocol scheme and any trailing slashes per spec.
 */
export function computePodcastGuid(feedUrl: string): string {
  const normalized = feedUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return uuidv5(normalized, PODCAST_NS_UUID)
}
