// One-shot URL migration: rewrite any audio_url / image_url / chapters_url /
// transcript_path values pointing at https://<site>/podcastepisodes/... or
// /podcastartwork/... to the content.<site> equivalent, for both episodes and
// the podcast-level image_url.
//
// Usage:
//   PODSHELF_API_KEY=... node scripts/migrate-content-urls.mjs            # dry-run
//   PODSHELF_API_KEY=... node scripts/migrate-content-urls.mjs --apply    # write
//   add --site=ys100m or --site=ywiw to limit to one podcast
//
// Pauses deploys on each podcast before patching and resumes when done, so a
// 60-episode rewrite produces one rebuild per site instead of 60.

const API_BASE = 'https://podshelf.hennemo.com'

const SITES = [
  { slug: 'ys100m', oldHost: 'yousaid100miles.com', newHost: 'content.yousaid100miles.com' },
  { slug: 'ywiw', oldHost: 'yourewatchingitwrong.com', newHost: 'content.yourewatchingitwrong.com' },
]

const URL_FIELDS = ['audio_url', 'image_url', 'chapters_url', 'transcript_path']

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const siteArg = args.find((a) => a.startsWith('--site='))?.split('=')[1]

const apiKey = process.env.PODSHELF_API_KEY
if (!apiKey) {
  console.error('PODSHELF_API_KEY env var is required')
  process.exit(1)
}

async function podshelf(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${init.method || 'GET'} ${path} → HTTP ${res.status}: ${text}`)
  }
  return res.json()
}

function rewrite(value, oldHost, newHost) {
  if (typeof value !== 'string' || !value) return null
  const prefixes = [
    `https://${oldHost}/podcastepisodes/`,
    `https://${oldHost}/podcastartwork/`,
    `http://${oldHost}/podcastepisodes/`,
    `http://${oldHost}/podcastartwork/`,
  ]
  for (const p of prefixes) {
    if (value.startsWith(p)) {
      return value.replace(`//${oldHost}/`, `//${newHost}/`)
    }
  }
  return null
}

async function setDeploysPaused(slug, paused) {
  return podshelf(`/api/podcasts/${slug}/deploys-paused`, {
    method: 'POST',
    body: JSON.stringify({ paused }),
  })
}

async function processSite({ slug, oldHost, newHost }) {
  console.log(`\n=== ${slug} (${oldHost} → ${newHost}) ===`)

  const podcast = await podshelf(`/api/podcasts/${slug}`)
  const podcastImagePatch = rewrite(podcast.image_url, oldHost, newHost)
  if (podcastImagePatch) {
    console.log(`  podcast.image_url: ${podcast.image_url}`)
    console.log(`                  → ${podcastImagePatch}`)
  } else {
    console.log(`  podcast.image_url: no change (${podcast.image_url || 'null'})`)
  }

  const episodes = await podshelf(
    `/api/podcasts/${slug}/episodes?fields=id,slug,audio_url,image_url,chapters_url,transcript_path`,
  )
  console.log(`  ${episodes.length} episodes total`)

  const epPatches = []
  for (const ep of episodes) {
    const patch = {}
    for (const f of URL_FIELDS) {
      const rewritten = rewrite(ep[f], oldHost, newHost)
      if (rewritten) patch[f] = rewritten
    }
    if (Object.keys(patch).length > 0) {
      epPatches.push({ id: ep.id, slug: ep.slug, patch, before: ep })
    }
  }
  console.log(`  ${epPatches.length} episodes need URL rewrites`)

  for (const { slug: epSlug, patch } of epPatches) {
    const lines = Object.entries(patch).map(([k, v]) => `      ${k}: ${v}`)
    console.log(`    [${epSlug}]\n${lines.join('\n')}`)
  }

  if (!apply) {
    console.log(`  (dry-run — pass --apply to write)`)
    return
  }

  const nothingToDo = !podcastImagePatch && epPatches.length === 0
  if (nothingToDo) {
    console.log(`  nothing to apply.`)
    return
  }

  console.log(`  pausing deploys for ${slug}...`)
  await setDeploysPaused(slug, true)

  try {
    if (podcastImagePatch) {
      console.log(`  PATCH /api/podcasts/${slug} (image_url)`)
      await podshelf(`/api/podcasts/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ image_url: podcastImagePatch }),
      })
    }
    let n = 0
    for (const { id, slug: epSlug, patch } of epPatches) {
      n += 1
      console.log(`  [${n}/${epPatches.length}] PATCH episodes/${id} (${epSlug})`)
      await podshelf(`/api/podcasts/${slug}/episodes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    }
  } finally {
    console.log(`  resuming deploys for ${slug}...`)
    await setDeploysPaused(slug, false)
  }
}

const targets = siteArg ? SITES.filter((s) => s.slug === siteArg) : SITES
if (targets.length === 0) {
  console.error(`Unknown site: ${siteArg}. Valid: ${SITES.map((s) => s.slug).join(', ')}`)
  process.exit(1)
}

for (const site of targets) {
  await processSite(site)
}

console.log(`\nDone (${apply ? 'applied' : 'dry-run'}).`)
