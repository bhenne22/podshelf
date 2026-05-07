import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeHttpsUpgrades } from '../server/utils/image-upgrade'

// Build a stub fetcher that returns a configured response for each URL.
function stubFetcher(responses: Record<string, { ok: boolean } | Error>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString()
    const r = responses[url]
    if (!r) throw new Error(`stubFetcher: unexpected URL ${url}`)
    if (r instanceof Error) throw r
    return { ok: r.ok } as Response
  }) as typeof fetch
}

test('probeHttpsUpgrades: swaps http→https when probe returns 2xx', async () => {
  const httpUrl = 'http://example.com/cover.jpg'
  const upgrades = await probeHttpsUpgrades(
    [httpUrl],
    stubFetcher({ 'https://example.com/cover.jpg': { ok: true } }),
  )
  assert.equal(upgrades.get(httpUrl), 'https://example.com/cover.jpg')
})

test('probeHttpsUpgrades: keeps http when probe returns non-2xx', async () => {
  const httpUrl = 'http://no-https.example.com/img.jpg'
  const upgrades = await probeHttpsUpgrades(
    [httpUrl],
    stubFetcher({ 'https://no-https.example.com/img.jpg': { ok: false } }),
  )
  assert.equal(upgrades.has(httpUrl), false, 'caller should keep the original http:// URL')
})

test('probeHttpsUpgrades: keeps http when probe throws (network error / bad cert)', async () => {
  const httpUrl = 'http://broken.example.com/img.jpg'
  const upgrades = await probeHttpsUpgrades(
    [httpUrl],
    stubFetcher({ 'https://broken.example.com/img.jpg': new Error('cert invalid') }),
  )
  assert.equal(upgrades.has(httpUrl), false)
})

test('probeHttpsUpgrades: ignores https:// inputs (no probe needed)', async () => {
  // The fetcher would throw on any URL — stubFetcher is unconfigured —
  // so a probe attempt would fail. https inputs must short-circuit.
  const upgrades = await probeHttpsUpgrades(
    ['https://example.com/already-secure.jpg'],
    stubFetcher({}),
  )
  assert.equal(upgrades.size, 0)
})

test('probeHttpsUpgrades: skips null / empty / undefined entries', async () => {
  const upgrades = await probeHttpsUpgrades(
    [null, undefined, '', 'https://safe.example.com/x.jpg'],
    stubFetcher({}),
  )
  assert.equal(upgrades.size, 0)
})

test('probeHttpsUpgrades: dedupes repeated URLs (one probe per unique URL)', async () => {
  let calls = 0
  const fetcher = (async () => { calls++; return { ok: true } as Response }) as typeof fetch
  const httpUrl = 'http://shared.example.com/cover.jpg'
  const upgrades = await probeHttpsUpgrades(
    [httpUrl, httpUrl, httpUrl, httpUrl],
    fetcher,
  )
  assert.equal(calls, 1, 'should fetch each unique URL exactly once')
  assert.equal(upgrades.get(httpUrl), 'https://shared.example.com/cover.jpg')
})

test('probeHttpsUpgrades: handles a mix of upgradeable, non-upgradeable, and https inputs', async () => {
  const ok = 'http://ok.example.com/a.jpg'
  const bad = 'http://bad.example.com/b.jpg'
  const safe = 'https://safe.example.com/c.jpg'
  const upgrades = await probeHttpsUpgrades(
    [ok, bad, safe, null],
    stubFetcher({
      'https://ok.example.com/a.jpg': { ok: true },
      'https://bad.example.com/b.jpg': { ok: false },
    }),
  )
  assert.equal(upgrades.get(ok), 'https://ok.example.com/a.jpg')
  assert.equal(upgrades.has(bad), false)
  assert.equal(upgrades.has(safe), false)
})
