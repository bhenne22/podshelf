import { deflateRawSync } from 'node:zlib'

/**
 * Minimal ZIP writer.
 *
 * Podshelf has no archive dependency and this needs one job done: bundle a
 * handful of small text files so a host can download a show's transcripts in
 * one click. That's ~120 lines of well-specified container format against
 * pulling in a tree of dependencies, so it's written out here.
 *
 * Deliberately narrow: no ZIP64 (entries and archives stay under 4 GB — the
 * largest show's transcripts are ~22 MB), no directory entries, no encryption.
 * Names are stored UTF-8 with the language-encoding flag set so accented
 * episode titles survive on Windows.
 */

export interface ZipEntry {
  /** Path inside the archive, e.g. "transcripts/ep0641-knives-out.srt". */
  name: string
  data: Buffer
  /** Defaults to now. Only the DOS-precision parts are kept (2-second resolution). */
  modified?: Date
}

// CRC-32 (IEEE 802.3), the checksum ZIP requires per entry. Table built once.
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

/** ZIP stores timestamps in the DOS format: 2-second resolution, epoch 1980. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const FLAG_UTF8 = 0x0800
const METHOD_DEFLATE = 8
const METHOD_STORE = 0

/**
 * Build a complete ZIP archive in memory.
 *
 * In-memory is fine at this scale (tens of MB) and keeps the handler simple;
 * callers should cap the total they pass in rather than relying on this to
 * stream.
 */
export function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const { time, date } = dosDateTime(entry.modified ?? new Date())
    const crc = crc32(entry.data)

    // Deflate unless it makes the entry bigger — true for tiny or already
    // compressed payloads, where storing is both smaller and cheaper.
    const deflated = deflateRawSync(entry.data)
    const useDeflate = deflated.length < entry.data.length
    const body = useDeflate ? deflated : entry.data
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    localParts.push(local, nameBuf, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42) // offset of local header
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + body.length
  }

  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // disk with central dir
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localParts, centralDir, eocd])
}

/** Make a string safe as a ZIP entry name / filename component. */
export function safeEntryName(name: string, fallback = 'file'): string {
  const cleaned = name
    // Separators would create (or escape) directories inside the archive.
    .replace(/[/\\]+/g, '-')
    // Control characters break archive tools on extraction.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || fallback
}
