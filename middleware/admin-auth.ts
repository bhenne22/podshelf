/**
 * Admin authentication middleware.
 *
 * Checks for an `admin_token` cookie that matches the ADMIN_PASSWORD env var.
 * If ADMIN_PASSWORD is not set (dev mode), access is allowed unconditionally.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (!to.path.startsWith('/admin')) return

  const adminPassword = useRuntimeConfig().adminPassword

  // If no admin password is configured, allow access (dev mode)
  if (!adminPassword) return

  // Check cookie — works client-side
  const token = useCookie('admin_token')
  if (token.value === adminPassword) return

  // Not authenticated — redirect to login
  return navigateTo('/admin/login')
})
