# Team Puma Knife launch checklist (Podshelf-side)

Drafted 2026-05-09 ahead of the TPK production transition. These are
Podshelf-side considerations only — TPK's own DNS / CDN / cache / mapping
work is out of scope. Believed addressed at the time of writing; kept here
for reference in case anything resurfaces.

## 1. PAT inventory + expiry

Two layers of GitHub PATs are now load-bearing:

- **Per-podcast in Podshelf** — each podcast's Build page stores an
  encrypted PAT with `Contents: write` on its dispatch target. If any are
  time-bound, expiry will silently 403 the next dispatch.
- **`TPK_DISPATCH_TOKEN`** secret in `bhenne22/yousaid100miles.com` and
  `bhenne22/yourewatchingitwrong.com` (and any future child-site repo). Same
  expiry concern.

Mitigation: calendar reminder a few weeks before any of these expire.

## 2. Slug stability has external consequences now

Before TPK, renaming a Podshelf slug was internal — `slug_aliases` kept the
RSS feed working for old subscribers. Now TPK consumes
`client_payload.slug` from every dispatch. If you rename a podcast slug,
TPK won't recognize the new value until its mapping is updated. The
aliases table only helps the feed, not downstream API consumers.

## 3. `build_admin_only=true` is the migration default

Every existing podcast got admin-only Build settings on migration. For most
shows that's right (sole admin: bob). When onboarding a non-admin host who
needs to edit GitHub config (event_type, owner/repo, PAT), flip
**Settings → Build Page Access → All podcast members** for that podcast
specifically. Trigger access via the **Rebuild Now** banner is open to all
members regardless of this setting.

## 4. The 15-minute debounce is now the publishing reality

Auto-publish fires 15 minutes after the most recent feed-visible change.
A flurry of edits coalesces into one build, not many. If you need a
publish to land *now* (e.g., coordinating a "go live at 9 AM" moment),
hit **Rebuild Now** in the pending-changes banner — it fires immediately
and clears the timer.

## 5. Direct Podshelf → TPK podcasts

The 6 podcasts without their own child site
(subtle-interference, oof-i-wrote-that, after-the-movie, btrw,
improvised-weapons, what-is-fun) each have a Podshelf GitHub config
pointing at `bhenne22/teampumaknife.com` with event_type
`podshelf-feed-update`. PAT rotation or event_type changes touch six
configs, not one. Sizing the maintenance surface, not flagging an issue.

## 6. DB backup before launch

Synology pulls nightly from the Linode (`/volume1/Backups`, capital B).
A fresh manual snapshot right before TPK goes public is cheap insurance —
this session added schema columns (`lifecycle`, `full_name`, `display_name`,
`build_admin_only`, `publish_dirty_first_at`, `publish_dirty_last_at`) and
a known-good rollback point makes any post-launch "oh no" moment into a
5-min recovery.

## 7. `[skip tpk]` convention is only on the two existing child sites

If you ever spin up a third child-site repo, remember to add the
`if: !contains(github.event.head_commit.message, '[skip tpk]')` guard on
its notify step so cosmetic / docs-only pushes can skip the TPK rebuild.

## 8. Audit log retention

Auto-trigger events log per fire (`podcast.github.auto-trigger`). No
retention policy — table grows monotonically. Not a launch blocker, but
that's where to add a TTL if it ever matters.

## 9. Webhooks (Discord/Slack) are independent of GitHub dispatch

Publish webhooks fire on episode-publish events, not on the
auto-debounced GitHub dispatch. So a "new episode" Discord announcement
happens at publish time regardless of when TPK rebuilds. No conflict — just
worth remembering when reasoning about timing.

## What's *not* a problem (verified)

- Podshelf has zero hardcoded knowledge of TPK — it's just another
  GitHub-dispatch target. Clean separation; no special-casing to maintain.
- The dispatch `client_payload` includes `slug`, `reason`, `podcast_id`,
  `fired_at` — every field a downstream workflow plausibly needs.
- The pending-changes banner is visible to non-admins on every podcast
  page, so co-hosts can self-serve **Rebuild Now** without involving an
  admin.
- The `requireBuildAccess` helper (admin-gates settings) is independent
  from `requirePodcastAccess` (member-gates everything else); the two
  permission models don't interfere.

## TPK-side items (out of scope here, listed for completeness)

- TPK's slug → metadata mapping (which podcasts it knows about and how it
  resolves their data). If a Podshelf slug changes, this needs updating.
- TPK's DNS / CDN / cache configuration.
- Smoke-test behavior when TPK receives rapid-fire dispatches from
  multiple shows at once (e.g., during a launch-day flurry).
