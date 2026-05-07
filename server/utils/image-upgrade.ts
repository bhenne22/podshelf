/**
 * Probe the https:// variant of each http:// URL in `urls` and return a
 * Map of urls that successfully responded 2xx, mapped to their https://
 * replacements. URLs not in the map should be kept as the original
 * http:// (the host doesn't support HTTPS, the host blocks HEAD, the
 * cert is invalid, the request timed out — all "leave it alone").
 *
 * Inputs are deduped — repeating the same URL costs one probe.
 *
 * The fetcher arg exists so tests can stub network calls. Callers in
 * production code should omit it.
 */
const PROBE_TIMEOUT_MS = 5000

export async function probeHttpsUpgrades(
  urls: (string | null | undefined)[],
  fetcher: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const httpUrls = [
    ...new Set(urls.filter((u): u is string => !!u && /^http:\/\//i.test(u))),
  ]
  const map = new Map<string, string>()
  await Promise.all(
    httpUrls.map(async (httpUrl) => {
      const httpsUrl = httpUrl.replace(/^http:/i, 'https:')
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
        const res = await fetcher(httpsUrl, {
          method: 'HEAD',
          signal: ctrl.signal,
          redirect: 'follow',
        })
        clearTimeout(t)
        if (res.ok) map.set(httpUrl, httpsUrl)
      } catch {
        // Probe failed — caller keeps the original http:// URL.
      }
    }),
  )
  return map
}
