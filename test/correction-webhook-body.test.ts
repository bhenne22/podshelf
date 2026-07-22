import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCorrectionBody } from '../server/utils/webhook'

// Correction fields are attacker-controlled — they arrive from an anonymous
// public endpoint and land in the hosts' Discord channel. These pin the
// payload shape and, more importantly, the sanitization.

const podcast = {
  slug: 'ys100m',
  title: 'You Said 100 Miles?',
  feed_url: 'https://podshelf.example/feeds/ys100m.xml',
  website: 'https://yousaid100miles.com',
}

const correction = {
  correction_id: 7,
  episode_title: "Where's the Finish?",
  episode_slug: 'ys100m-wheres-the-finish',
  episode_url: 'https://yousaid100miles.com/episodes/ys100m-wheres-the-finish',
  timecode: '1:04:12',
  claim: 'We said Hyner is 50 miles.',
  correction: 'Hyner is a 25k and a 50k.',
  source_url: 'https://example.com/hyner',
  submitter_name: 'Shae',
  submitter_contact: 'shae@example.com',
  triage_url: 'https://podshelf.example/podcasts/ys100m/corrections',
}

test('discord body carries the claim, correction and triage link', () => {
  const { body, contentType } = buildCorrectionBody(
    { url: 'https://discord.com/api/webhooks/x', format: 'discord', enabled: true },
    podcast,
    correction,
  )
  assert.equal(contentType, 'application/json')
  const parsed = JSON.parse(body)
  const embed = parsed.embeds[0]
  assert.match(embed.title, /Where's the Finish\? @ 1:04:12/)
  assert.equal(embed.url, correction.triage_url)
  assert.match(embed.description, /Submitted by Shae/)
  const names = embed.fields.map((f: { name: string }) => f.name)
  assert.deepEqual(names, ['We said', "What's actually true", 'Source', 'Contact'])
})

test('discord body neutralizes @everyone and markdown from submitted text', () => {
  const { body } = buildCorrectionBody(
    { url: 'https://discord.com/api/webhooks/x', format: 'discord', enabled: true },
    podcast,
    { ...correction, claim: '@everyone **free pills** `code`', submitter_name: '@here _sneaky_' },
  )
  // The raw pings must not survive into the payload.
  assert.equal(/@everyone(?!​)/.test(body), false)
  assert.equal(/@here(?!​)/.test(body), false)
  const parsed = JSON.parse(body)
  const said = parsed.embeds[0].fields[0].value
  assert.match(said, /\\\*\\\*free pills\\\*\\\*/)
  assert.match(said, /\\`code\\`/)
})

test('anonymous submission with no episode still produces a usable message', () => {
  const { body } = buildCorrectionBody(
    { url: 'https://discord.com/api/webhooks/x', format: 'discord', enabled: true },
    podcast,
    {
      ...correction,
      episode_title: null,
      episode_slug: null,
      episode_url: null,
      timecode: null,
      source_url: null,
      submitter_name: null,
      submitter_contact: null,
    },
  )
  const parsed = JSON.parse(body)
  assert.match(parsed.embeds[0].title, /no episode specified/)
  assert.match(parsed.embeds[0].description, /Submitted by Anonymous/)
  // Optional fields are omitted, not rendered empty.
  assert.equal(parsed.embeds[0].fields.length, 2)
})

test('generic body is the raw event envelope', () => {
  const { body } = buildCorrectionBody(
    { url: 'https://example.com/hook', format: 'generic', enabled: true },
    podcast,
    correction,
  )
  const parsed = JSON.parse(body)
  assert.equal(parsed.event, 'correction.submitted')
  assert.equal(parsed.podcast.slug, 'ys100m')
  assert.equal(parsed.correction.correction_id, 7)
  // Generic consumers get the unescaped original.
  assert.equal(parsed.correction.claim, correction.claim)
})

test('slack body includes the triage link', () => {
  const { body } = buildCorrectionBody(
    { url: 'https://hooks.slack.com/services/x', format: 'slack', enabled: true },
    podcast,
    correction,
  )
  const parsed = JSON.parse(body)
  assert.match(parsed.blocks[0].text.text, /Triage in Podshelf/)
})
