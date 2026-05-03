/**
 * Admin required.
 *
 * Bounces non-admins to the home dashboard, and unauthenticated callers
 * to /login. Same /api/me probe as the regular auth middleware so SSR
 * and SPA navigation behave identically. Transient errors (network,
 * dev-server HMR, etc.) are logged and ignored.
 */
export default defineNuxtRouteMiddleware(async () => {
  try {
    // useRequestHeaders forwards the inbound request's cookie during SSR;
    // on the client it returns {} (browser fetch sends cookies natively).
    // Without this, $fetch('/api/me') during SSR has no session and 401s
    // even when the user is logged in.
    const me = await $fetch<{ is_admin: boolean }>('/api/me', {
      headers: useRequestHeaders(['cookie']),
    })
    if (!me?.is_admin) {
      return navigateTo('/')
    }
  } catch (err: unknown) {
    const e = err as { statusCode?: number; response?: { status?: number } }
    const status = e?.statusCode ?? e?.response?.status
    if (status === 401) {
      return navigateTo('/login')
    }
    console.warn('admin-only: ignoring non-401 error from /api/me', status, err)
  }
})
