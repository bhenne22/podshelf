import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStallBody } from '../server/utils/webhook'

// The stall alert is the operator's only push signal that a publish's site
// deploy never landed (2026-11-01: a failed ywiw deploy went unnoticed while
// the public announcement posted a 404 link). These pin that it names the
// episode, links the page that failed, and says the announcement is held.

const podcast = {
  slug: 'ywiw',
  title: "You're Watching It Wrong",
  feed_url: 'https://podshelf.example/feeds/ywiw.xml',
  website: 'https://yourewatchingitwrong.com',
}

const stall = {
  episode_title: 'Side Swipe: Wildwood',
  episode_url: 'https://yourewatchingitwrong.com/episodes/side-swipe-wildwood',
  waited_minutes: 30,
  max_wait_minutes: 24 * 60,
  last_status: 404,
  last_error: null,
}

test('discord body names the episode, links the dead page, and says it is held', () => {
  const { body, contentType } = buildStallBody(
    { url: 'https://discord.com/api/webhooks/x', format: 'discord', enabled: true },
    podcast,
    stall,
  )
  assert.equal(contentType, 'application/json')
  const parsed = JSON.parse(body)
  assert.match(parsed.content, /Side Swipe: Wildwood/)
  assert.match(parsed.content, /after 30m/)
  assert.equal(parsed.embeds[0].url, stall.episode_url)
  assert.match(parsed.embeds[0].description, /HTTP 404/)
  assert.match(parsed.embeds[0].description, /held/)
  assert.match(parsed.embeds[0].description, /24h/)
})

test('a probe error is reported when there was no HTTP status', () => {
  const { body } = buildStallBody(
    { url: 'https://discord.com/api/webhooks/x', format: 'discord', enabled: true },
    podcast,
    { ...stall, last_status: null, last_error: 'fetch failed' },
  )
  assert.match(JSON.parse(body).embeds[0].description, /Last check: fetch failed/)
})

test('slack body carries the headline as fallback text', () => {
  const { body } = buildStallBody(
    { url: 'https://hooks.slack.com/services/x', format: 'slack', enabled: true },
    podcast,
    stall,
  )
  const parsed = JSON.parse(body)
  assert.match(parsed.text, /still isn't live after 30m/)
  assert.match(parsed.blocks[0].text.text, /side-swipe-wildwood/)
})

test('generic body is tagged with the stalled event', () => {
  const { body } = buildStallBody(
    { url: 'https://example.com/hook', format: 'generic', enabled: true },
    podcast,
    stall,
  )
  const parsed = JSON.parse(body)
  assert.equal(parsed.event, 'episode.publish.stalled')
  assert.deepEqual(parsed.stall, stall)
})
