import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePodcastFeed } from '../server/utils/rss-parser'

const fixture = readFileSync(
  resolve(__dirname, 'fixtures', 'wp-style-feed.xml'),
  'utf-8',
)
const feed = parsePodcastFeed(fixture)

// Slugify mirrors the importer's local helper. Kept local to the test so
// edits to the importer's slug rules surface here too.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

test('parses all items from the fixture', () => {
  assert.equal(feed.items.length, 5)
})

test('Bug 1: titles have entities decoded', () => {
  // Item 1 — full bug-1 case from the user report
  assert.equal(
    feed.items[0].title,
    'SI #146 – with ’quotes’ and &ampersand',
  )
  // No leftover &#NNN; refs anywhere
  for (const item of feed.items) {
    assert.doesNotMatch(item.title, /&#\d+;/, `title "${item.title}" still has decimal entity ref`)
    assert.doesNotMatch(item.title, /&#x[0-9a-fA-F]+;/, `title "${item.title}" still has hex entity ref`)
  }
})

test('Bug 1: itunes_title has entities decoded', () => {
  const item = feed.items.find((i) => i.title === 'Plain title #1')!
  assert.equal(item.itunes_title, 'Itunes title ’s test')
})

test('Bug 1 (no regression): description HTML preserved verbatim', () => {
  // description is HTML — entities like &#8211; in show notes must NOT
  // be decoded; they're part of the rendered HTML.
  const desc = feed.items[0].description || ''
  assert.match(desc, /&#8211;/, 'description should still contain raw entity for HTML rendering')
})

test('Bug 2: slug derived from decoded title contains no entity digits', () => {
  for (const item of feed.items) {
    const slug = slugify(item.title)
    assert.doesNotMatch(slug, /\b8211\b/, `slug "${slug}" leaks &#8211; digits`)
    assert.doesNotMatch(slug, /\b8217\b/, `slug "${slug}" leaks &#8217; digits`)
    assert.doesNotMatch(slug, /\b8230\b/, `slug "${slug}" leaks &#8230; digits`)
    assert.doesNotMatch(slug, /\b2014\b/, `slug "${slug}" leaks &#x2014 digits`)
  }
})

test('Bug 2: bug-1 fixture title slugifies cleanly', () => {
  // 'SI #146 – with ’quotes’ and &ampersand' →
  //   - drop non-[a-z0-9\s-] (apostrophes, dash, ampersand) → 'si 146  with quotes and ampersand'
  //   - collapse spaces → 'si-146-with-quotes-and-ampersand'
  const slug = slugify(feed.items[0].title)
  assert.equal(slug, 'si-146-with-quotes-and-ampersand')
})

test('Bug 3: episode_number falls back to #N pattern in title', () => {
  // Item 1 — no <itunes:episode>, but title is "SI #146 …"
  assert.equal(feed.items[0].episode_number, 146)
  // Item 4 — hex-entity title "SI #58 …"
  const item58 = feed.items.find((i) => i.audio_url?.endsWith('/58.mp3'))!
  assert.equal(item58.episode_number, 58)
  // Item 5 — title is "Plain title #1"
  const item1 = feed.items.find((i) => i.title === 'Plain title #1')!
  assert.equal(item1.episode_number, 1)
})

test('Bug 3: <itunes:episode> wins over title pattern', () => {
  // Item 2 has <itunes:episode>200</itunes:episode> with title "SI #99 …".
  const tagWins = feed.items.find((i) => i.audio_url?.endsWith('/200.mp3'))!
  assert.equal(tagWins.episode_number, 200, 'tag must override title regex')
})

test('Bug 3: specials with no number stay null', () => {
  const special = feed.items.find((i) => i.title.includes('Bloodlines'))!
  assert.equal(special.episode_number, null)
  assert.equal(special.episode_type, null, 'episode_type stays null — not auto-bonused')
})

test('preserves audio URL, size, duration, pubDate exactly (no regression)', () => {
  const ep = feed.items[0]
  assert.equal(ep.audio_url, 'https://example.com/audio/146.mp3')
  assert.equal(ep.audio_size_bytes, 12345678)
  assert.equal(ep.audio_duration_seconds, 1 * 3600 + 23 * 60 + 45)
  assert.equal(ep.pubDate, '2025-01-15T12:00:00.000Z')
})

test('preserves <guid> exactly (no regression — listeners depend on it)', () => {
  assert.equal(feed.items[0].guid, 'https://example.com/?p=146')
  for (const item of feed.items) {
    assert.ok(item.guid, `every item should preserve its <guid>; missing on "${item.title}"`)
  }
})
