<template>
  <div class="user-typeahead" @click.stop>
    <input
      ref="inputRef"
      v-model="query"
      type="text"
      :placeholder="placeholder"
      autocomplete="off"
      :disabled="disabled"
      @input="onInput"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="pickActive"
      @keydown.esc="results = []"
      @focus="onFocus"
    />
    <div v-if="results.length" class="results" role="listbox">
      <button
        v-for="(u, i) in results"
        :key="u.id"
        type="button"
        role="option"
        class="result"
        :class="{ active: i === activeIndex }"
        @mouseenter="activeIndex = i"
        @click="pick(u)"
      >
        <span class="primary">{{ primaryName(u) }}</span>
        <span v-if="primaryName(u) !== u.email" class="secondary">{{ u.email }}</span>
      </button>
    </div>
    <div v-else-if="query && !pending && searched" class="results empty">No matches.</div>
  </div>
</template>

<script setup lang="ts">
interface UserOption {
  id: number
  email: string
  full_name: string | null
  display_name: string | null
  is_admin?: number
}

const props = defineProps<{
  placeholder?: string
  disabled?: boolean
  excludeIds?: number[]
}>()

const emit = defineEmits<{
  (e: 'select', user: UserOption): void
}>()

const query = ref('')
const results = ref<UserOption[]>([])
const activeIndex = ref(0)
const pending = ref(false)
const searched = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

let debounceHandle: ReturnType<typeof setTimeout> | null = null

function primaryName(u: UserOption): string {
  return u.display_name || u.full_name || u.email
}

function onInput() {
  if (debounceHandle) clearTimeout(debounceHandle)
  debounceHandle = setTimeout(runSearch, 200)
}

function onFocus() {
  if (query.value && !results.value.length) runSearch()
}

async function runSearch() {
  const q = query.value.trim()
  if (!q) {
    results.value = []
    searched.value = false
    return
  }
  pending.value = true
  try {
    const data = await $fetch<UserOption[]>('/api/users/search', { query: { q } })
    const exclude = new Set(props.excludeIds || [])
    results.value = (data || []).filter((u) => !exclude.has(u.id))
    activeIndex.value = 0
    searched.value = true
  } catch {
    results.value = []
  } finally {
    pending.value = false
  }
}

function move(dir: 1 | -1) {
  if (!results.value.length) return
  const next = activeIndex.value + dir
  if (next < 0) activeIndex.value = results.value.length - 1
  else if (next >= results.value.length) activeIndex.value = 0
  else activeIndex.value = next
}

function pickActive() {
  const u = results.value[activeIndex.value]
  if (u) pick(u)
}

function pick(u: UserOption) {
  emit('select', u)
  query.value = ''
  results.value = []
  searched.value = false
  inputRef.value?.focus()
}

defineExpose({
  focus: () => inputRef.value?.focus(),
  clear: () => {
    query.value = ''
    results.value = []
    searched.value = false
  },
})
</script>

<style scoped>
.user-typeahead {
  position: relative;
}
.user-typeahead input {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
}
.user-typeahead input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}
.user-typeahead input:disabled {
  background: #f7fafc;
  color: #a0aec0;
  cursor: not-allowed;
}

.results {
  position: absolute;
  z-index: 100;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.25rem;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.18);
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.results.empty {
  color: #a0aec0;
  font-size: 0.85rem;
  padding: 0.6rem 0.65rem;
}

.result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 0.45rem 0.65rem;
  background: none;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.result:hover, .result.active {
  background: #edf2f7;
}
.primary {
  font-size: 0.9rem;
  color: #1a202c;
  font-weight: 500;
}
.secondary {
  font-size: 0.78rem;
  color: #718096;
}

@media (max-width: 720px) {
  .user-typeahead input {
    padding: 0.625rem 0.75rem;
    min-height: 44px;
    font-size: 1rem;
  }
}
</style>
