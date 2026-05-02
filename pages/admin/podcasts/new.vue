<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>New Podcast</h1>
        <NuxtLink to="/admin" class="btn-back">← All podcasts</NuxtLink>
      </div>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <form @submit.prevent="onSubmit" class="form">
        <div class="form-section">
          <div class="form-group">
            <label for="title">Title <span class="required">*</span></label>
            <input id="title" v-model="form.title" type="text" required @input="autoSlug" />
          </div>
          <div class="form-group">
            <label for="slug">Slug <span class="hint">(used in /admin/[slug] and /feeds/[slug].xml)</span></label>
            <input id="slug" v-model="form.slug" type="text" placeholder="auto-generated from title" />
          </div>
          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" v-model="form.description" rows="3" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="author">Author</label>
              <input id="author" v-model="form.author" type="text" />
            </div>
            <div class="form-group">
              <label for="email">Contact Email</label>
              <input id="email" v-model="form.email" type="email" />
            </div>
          </div>
          <div class="form-group">
            <label for="website">Website (public site)</label>
            <input id="website" v-model="form.website" type="url" placeholder="https://yourpodcast.example.com" />
          </div>
        </div>

        <div class="form-actions">
          <NuxtLink to="/admin" class="btn-secondary">Cancel</NuxtLink>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Creating…' : 'Create Podcast' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth' })

const router = useRouter()
const errorMsg = ref('')
const saving = ref(false)
let slugManuallyEdited = false

const form = reactive({
  title: '',
  slug: '',
  description: '',
  author: '',
  email: '',
  website: '',
})

function slugify(text: string): string {
  return text.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function autoSlug() {
  if (!slugManuallyEdited) form.slug = slugify(form.title)
}

watch(() => form.slug, (val) => {
  if (val !== slugify(form.title)) slugManuallyEdited = true
})

async function onSubmit() {
  saving.value = true
  errorMsg.value = ''
  try {
    const created = await $fetch<{ slug: string }>('/api/podcasts', {
      method: 'POST',
      body: { ...form },
    })
    await router.push(`/admin/${created.slug}/settings`)
  } catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    errorMsg.value = e?.data?.statusMessage || e?.message || 'Failed to create podcast'
  } finally {
    saving.value = false
  }
}

useHead({ title: 'New Podcast — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }
.btn-back { font-size: 0.875rem; color: #667eea; text-decoration: none; }
.btn-back:hover { text-decoration: underline; }

.form { display: flex; flex-direction: column; gap: 1.5rem; }
.form-section { background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1.5rem; }

.form-group { margin-bottom: 1rem; }
.form-group:last-child { margin-bottom: 0; }
.form-row { display: flex; gap: 1rem; }
.form-row .form-group { flex: 1; }

label { display: block; font-size: 0.875rem; font-weight: 500; color: #4a5568; margin-bottom: 0.375rem; }
.required { color: #e53e3e; }
.hint { font-size: 0.78rem; color: #718096; font-weight: normal; }

input, textarea {
  display: block; width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  font-family: inherit;
  background: white;
  outline: none;
}
input:focus, textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
}

.form-actions { display: flex; justify-content: flex-end; gap: 0.75rem; padding-bottom: 2rem; }
.btn-primary {
  padding: 0.6rem 1.25rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.9rem; font-weight: 500;
  cursor: pointer; text-decoration: none;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-secondary {
  padding: 0.6rem 1.25rem;
  background: white; color: #4a5568;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem; cursor: pointer; text-decoration: none;
}
.btn-secondary:hover { background: #f7fafc; }

.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}
</style>
