import getDb from '../db/index'

/**
 * Marks the podcast's feed as modified now. Drives the Last-Modified
 * header / 304 Not Modified response on the public feed.
 *
 * Called from any code path that changes what the feed will render —
 * episode CRUD on published episodes, podcast settings edits to
 * feed-visible fields, and RSS imports.
 */
export function bumpFeedLastModified(podcastId: number) {
  getDb()
    .prepare("UPDATE podcasts SET feed_last_modified = datetime('now') WHERE id = ?")
    .run(podcastId)
}
