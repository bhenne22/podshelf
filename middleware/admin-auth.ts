/**
 * Admin authentication middleware.
 *
 * Hits /api/me — the only request that can validate the httpOnly session
 * cookie regardless of whether the middleware runs server-side (SSR/initial
 * load) or client-side (in-app navigation). Only treats an explicit 401 as
 * "not authenticated"; transient errors (network, dev-server HMR, etc.)
 * are logged and ignored so they don't randomly bounce a logged-in user
 * back to the login page.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/admin')) return
  if (to.path === '/admin/login') return

  try {
    await $fetch('/api/me')
  } catch (err: unknown) {
    const e = err as { statusCode?: number; response?: { status?: number } }
    const status = e?.statusCode ?? e?.response?.status
    if (status === 401) {
      return navigateTo('/admin/login')
    }
    console.warn('admin-auth: ignoring non-401 error from /api/me', status, err)
  }
})
