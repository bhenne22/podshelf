import { existsSync } from 'fs'
import { createRequire } from 'module'

const _require = createRequire(import.meta.url)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _reader: any = null
let _readerPath: string | null = null

async function getReader(): Promise<any> {
  const dbPath = (useRuntimeConfig().geoipDbPath || '').trim()

  if (!dbPath || !existsSync(dbPath)) return null
  if (_reader && _readerPath === dbPath) return _reader

  const maxmind = _require('maxmind')
  _reader = await maxmind.open(dbPath)
  _readerPath = dbPath
  return _reader
}

export async function lookupIp(ip: string): Promise<{ country: string; region: string; city: string } | null> {
  try {
    const reader = await getReader()
    if (!reader) return null

    const result = reader.get(ip)
    if (!result) return null

    return {
      country: result.country?.iso_code || '',
      region: result.subdivisions?.[0]?.names?.en || '',
      city: result.city?.names?.en || '',
    }
  } catch {
    return null
  }
}
