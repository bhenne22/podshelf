/**
 * Login required.
 *
 * Hits /api/me — the only request that can validate the httpOnly session
 * cookie regardless of whether the middleware runs server-side (SSR/initial
 * load) or client-side (in-app navigation). Only treats an explicit 401 as
 * "not authenticated"; transient errors (network, dev-server HMR, etc.)
 * are logged and ignored so they don't randomly bounce a logged-in user
 * back to the login page.
 */
export default defineNuxtRouteMiddleware(async () => {
  try {
    // useRequestHeaders forwards the inbound request's cookie during SSR;
    // on the client it returns {} (browser fetch sends cookies natively).
    // Without this, $fetch('/api/me') during SSR has no session and 401s
    // even when the user is logged in.
    await $fetch('/api/me', { headers: useRequestHeaders(['cookie']) })
  } catch (err: unknown) {
    const e = err as { statusCode?: number; response?: { status?: number } }
    const status = e?.statusCode ?? e?.response?.status
    if (status === 401) {
      return navigateTo('/login')
    }
    console.warn('auth: ignoring non-401 error from /api/me', status, err)
  }
})
