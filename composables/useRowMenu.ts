/**
 * Shared per-row hamburger-menu state for the episodes / api-keys / users
 * tables. Tracks which row's menu is open, decides whether to drop the
 * panel down or flip it up when the trigger is too close to the viewport
 * bottom, and wires up click-outside + Escape to close.
 *
 * Usage in a page:
 *   const { openMenuId, menuDirection, toggleMenu, closeMenu } = useRowMenu()
 *   ...
 *   <button @click.stop="toggleMenu(row.id, $event)">⋯</button>
 *   <div v-if="openMenuId === row.id"
 *        class="row-menu-panel"
 *        :class="{ up: menuDirection === 'up' }">…</div>
 *
 * The CSS pairs with a `.row-menu-panel.up { top: auto; bottom: 100%+4px }`
 * rule (already added to each consumer's <style> block).
 */
export function useRowMenu(estimatedPanelHeight = 200) {
  const openMenuId = ref<number | string | null>(null)
  const menuDirection = ref<'down' | 'up'>('down')

  function toggleMenu(id: number | string, ev?: Event) {
    if (openMenuId.value === id) {
      openMenuId.value = null
      return
    }
    if (typeof window !== 'undefined' && ev) {
      // currentTarget is the actual <button> the listener is bound to.
      // Fall back to walking up from target in case currentTarget is null
      // (it's nulled after the handler returns in some flows).
      const btn = ((ev.currentTarget as HTMLElement | null)
        || (ev.target as HTMLElement | null)?.closest('button')) as HTMLElement | null
      if (btn) {
        const rect = btn.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        // 16px buffer keeps the panel off the viewport edge.
        menuDirection.value = spaceBelow < estimatedPanelHeight + 16 ? 'up' : 'down'
      }
    } else {
      menuDirection.value = 'down'
    }
    openMenuId.value = id
  }

  function closeMenu() {
    openMenuId.value = null
  }

  function onDocClick(e: MouseEvent) {
    if (openMenuId.value === null) return
    const target = e.target as HTMLElement | null
    if (target?.closest('.row-menu')) return
    openMenuId.value = null
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && openMenuId.value !== null) closeMenu()
  }

  onMounted(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onDocKeydown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onDocKeydown)
  })

  return { openMenuId, menuDirection, toggleMenu, closeMenu }
}
