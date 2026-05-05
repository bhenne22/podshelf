<template>
  <div class="docs-page">
    <AdminNav v-if="me" />
    <nav v-else class="public-nav">
      <NuxtLink to="/" class="brand">Podshelf</NuxtLink>
      <NuxtLink to="/login" class="signin">Sign in</NuxtLink>
    </nav>
    <div class="container">
      <div class="page-header">
        <h1>API Docs</h1>
        <NuxtLink v-if="me" to="/api-keys" class="btn-back">Manage API keys →</NuxtLink>
      </div>
      <p class="intro">
        Interactive reference for the Podshelf API. Click <strong>Authorize</strong>
        and paste your API key to use <em>Try it out</em> against this instance.
        <template v-if="me">
          Generate a key at <NuxtLink to="/api-keys">/api-keys</NuxtLink> if you
          don't have one yet.
        </template>
        <template v-else>
          <NuxtLink to="/login">Sign in</NuxtLink> to generate a key.
        </template>
      </p>

      <ClientOnly>
        <div id="swagger-ui-mount" class="swagger-mount"></div>
        <template #fallback>
          <div class="loading">Loading API docs…</div>
        </template>
      </ClientOnly>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({ title: 'API Docs — Podshelf' })

interface Me { id: number; email: string; is_admin: boolean }

// Public page — anonymous visitors get a 401 from /api/me, which we swallow
// so SSR doesn't blow up. Authed visitors see the normal AdminNav.
const { data: me } = await useFetch<Me | null>('/api/me', {
  default: () => null,
  ignoreResponseError: true,
})

type SwaggerUIInit = (config: Record<string, unknown>) => unknown

onMounted(async () => {
  // swagger-ui-dist is ~3MB; lazy-loaded so it only ships on this page.
  const [{ default: SwaggerUIBundle }] = await Promise.all([
    import('swagger-ui-dist/swagger-ui-bundle.js') as Promise<{ default: SwaggerUIInit }>,
    import('swagger-ui-dist/swagger-ui.css'),
  ])

  SwaggerUIBundle({
    url: '/openapi.yaml',
    dom_id: '#swagger-ui-mount',
    deepLinking: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 0,
    // Authorize once, stays authorized across reloads (Swagger UI handles
    // localStorage; we just enable the flag).
    persistAuthorization: true,
    layout: 'BaseLayout',
  })
})
</script>

<style scoped>
.docs-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.public-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 1.5rem;
  height: 56px;
  position: sticky;
  top: 0;
  z-index: 100;
}
.public-nav .brand {
  font-weight: 700;
  font-size: 1.1rem;
  color: #667eea;
  text-decoration: none;
  letter-spacing: -0.02em;
}
.public-nav .signin {
  font-size: 0.9rem;
  color: #4a5568;
  text-decoration: none;
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
}
.public-nav .signin:hover {
  background: #f7fafc;
  color: #1a202c;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 4rem;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  gap: 1rem;
  flex-wrap: wrap;
}

h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }

.btn-back {
  font-size: 0.875rem;
  color: #667eea;
  text-decoration: none;
}
.btn-back:hover { text-decoration: underline; }

.intro {
  color: #4a5568;
  font-size: 0.92rem;
  margin: 0 0 1.25rem;
  line-height: 1.55;
}
.intro a { color: #667eea; }

.swagger-mount {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.loading {
  color: #718096;
  padding: 3rem;
  text-align: center;
}

/* Tweak Swagger UI's defaults to match the Podshelf chrome */
:deep(.swagger-ui) {
  font-family: system-ui, -apple-system, sans-serif;
}
:deep(.swagger-ui .topbar) {
  display: none;
}
:deep(.swagger-ui .info) {
  margin: 1.5rem 1.25rem;
}
:deep(.swagger-ui .scheme-container) {
  background: #f7fafc;
  box-shadow: none;
  border-bottom: 1px solid #e2e8f0;
  padding: 1rem 1.25rem;
}
</style>
