<template>
  <nav class="admin-nav">
    <div class="nav-brand">
      <NuxtLink to="/admin">Podshelf</NuxtLink>
    </div>
    <ul class="nav-links">
      <li>
        <NuxtLink to="/admin/episodes" active-class="active">Episodes</NuxtLink>
      </li>
      <li>
        <NuxtLink to="/admin/settings" active-class="active">Settings</NuxtLink>
      </li>
      <li class="divider"></li>
      <li>
        <NuxtLink to="/" target="_blank" rel="noopener">View Site ↗</NuxtLink>
      </li>
      <li>
        <a href="/feed.xml" target="_blank" rel="noopener">RSS Feed ↗</a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.admin-nav {
  display: flex;
  align-items: center;
  gap: 2rem;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 1.5rem;
  height: 56px;
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-brand a {
  font-weight: 700;
  font-size: 1.1rem;
  color: #667eea;
  text-decoration: none;
  letter-spacing: -0.02em;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-links a {
  display: block;
  padding: 0.375rem 0.75rem;
  color: #4a5568;
  text-decoration: none;
  border-radius: 6px;
  font-size: 0.9rem;
  transition: background 0.15s, color 0.15s;
}

.nav-links a:hover {
  background: #f7fafc;
  color: #1a202c;
}

.nav-links a.active {
  background: #ebf4ff;
  color: #4c51bf;
  font-weight: 500;
}

.divider {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
  margin: 0 0.5rem;
}
</style>
