import { startScheduler } from '../utils/scheduler'

/**
 * Boot the in-process scheduled-publishing timer when the server starts.
 * Nitro auto-loads files in server/plugins/ at startup.
 */
export default defineNitroPlugin(() => {
  startScheduler()
})
