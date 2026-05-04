import { startMigrationWorker } from '../utils/storage-migration'

/**
 * Boot the in-process storage migration worker. Picks pending migrations
 * off the queue and copies files end-to-end.
 */
export default defineNitroPlugin(() => {
  startMigrationWorker()
})
