/**
 * Admin authentication middleware.
 *
 * On the client side, checks for the existence of the `admin_session` cookie.
 * The actual token validation happens server-side in requireAuth().
 * If ADMIN_PASSWORD is not set (dev mode), access is allowed unconditionally.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (!to.path.startsWith('/admin')) return
  if (to.path === '/admin/login') return

  const adminPassword = useRuntimeConfig().adminPassword

  // If no admin password is configured, allow access (dev mode)
  if (!adminPassword) return

  // Check that session cookie exists — server validates the signature
  const session = useCookie('admin_session')
  if (session.value) return

  // Not authenticated — redirect to login
  return navigateTo('/admin/login')
})
