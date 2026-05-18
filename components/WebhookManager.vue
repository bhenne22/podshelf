<template>
  <div class="webhook-manager">
    <p v-if="loadError" class="webhook-msg err">{{ loadError }}</p>

    <div v-if="webhooks.length === 0 && !showAdd" class="empty">
      No webhooks configured.
    </div>

    <div v-for="wh in webhooks" :key="wh.id" class="webhook-card">
      <div class="card-row">
        <div class="form-group flex-grow">
          <label :for="`wh-name-${wh.id}`">Name</label>
          <input :id="`wh-name-${wh.id}`" v-model="wh.name" type="text"
            :placeholder="wh.format === 'discord' ? 'Discord #releases' : wh.format === 'slack' ? 'Slack #releases' : 'Generic webhook'" />
        </div>
        <div class="form-group">
          <label :for="`wh-format-${wh.id}`">Format</label>
          <select :id="`wh-format-${wh.id}`" v-model="wh.format">
            <option value="generic">Generic JSON</option>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
          </select>
        </div>
        <div class="form-group">
          <label :for="`wh-enabled-${wh.id}`">Status</label>
          <select :id="`wh-enabled-${wh.id}`" v-model="wh.enabled">
            <option :value="false">Disabled</option>
            <option :value="true">Enabled</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label :for="`wh-url-${wh.id}`">Webhook URL</label>
        <input :id="`wh-url-${wh.id}`" v-model="wh.urlInput" type="url"
          :placeholder="`(set; host ${wh.url_host || 'unknown'}) — leave blank to keep`" />
        <p class="hint">
          Leave blank to keep the existing URL. Stored encrypted at rest.
        </p>
      </div>

      <fieldset class="events-fieldset">
        <legend>Events</legend>
        <label v-for="ev in ALL_EVENTS" :key="ev.value" class="event-check">
          <input type="checkbox" :checked="wh.events.includes(ev.value)"
            @change="toggleEvent(wh, ev.value, ($event.target as HTMLInputElement).checked)" />
          <span class="ev-name">{{ ev.value }}</span>
          <span class="ev-desc">{{ ev.label }}</span>
        </label>
      </fieldset>

      <div class="webhook-actions">
        <button type="button" class="btn-secondary" :disabled="wh.busy" @click="testHook(wh)">
          {{ wh.testing ? 'Sending…' : 'Send test' }}
        </button>
        <button type="button" class="btn-secondary" :disabled="wh.busy" @click="saveHook(wh)">
          {{ wh.saving ? 'Saving…' : 'Save' }}
        </button>
        <button type="button" class="btn-danger" :disabled="wh.busy" @click="deleteHook(wh)">
          {{ wh.deleting ? 'Deleting…' : 'Delete' }}
        </button>
        <span v-if="wh.msg" class="webhook-msg" :class="{ ok: wh.msgOk, err: !wh.msgOk }">
          {{ wh.msg }}
        </span>
      </div>
    </div>

    <div v-if="showAdd" class="webhook-card add-card">
      <div class="card-row">
        <div class="form-group flex-grow">
          <label for="new-wh-name">Name</label>
          <input id="new-wh-name" v-model="newHook.name" type="text" placeholder="Discord #releases" />
        </div>
        <div class="form-group">
          <label for="new-wh-format">Format</label>
          <select id="new-wh-format" v-model="newHook.format">
            <option value="generic">Generic JSON</option>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
          </select>
        </div>
        <div class="form-group">
          <label for="new-wh-enabled">Status</label>
          <select id="new-wh-enabled" v-model="newHook.enabled">
            <option :value="false">Disabled</option>
            <option :value="true">Enabled</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label for="new-wh-url">Webhook URL</label>
        <input id="new-wh-url" v-model="newHook.url" type="url"
          placeholder="https://discord.com/api/webhooks/…" />
      </div>
      <fieldset class="events-fieldset">
        <legend>Events</legend>
        <label v-for="ev in ALL_EVENTS" :key="ev.value" class="event-check">
          <input type="checkbox" :checked="newHook.events.includes(ev.value)"
            @change="toggleNewEvent(ev.value, ($event.target as HTMLInputElement).checked)" />
          <span class="ev-name">{{ ev.value }}</span>
          <span class="ev-desc">{{ ev.label }}</span>
        </label>
      </fieldset>
      <div class="webhook-actions">
        <button type="button" class="btn-secondary" :disabled="adding" @click="createHook">
          {{ adding ? 'Creating…' : 'Create webhook' }}
        </button>
        <button type="button" class="btn-secondary" @click="cancelAdd">Cancel</button>
        <span v-if="addMsg" class="webhook-msg err">{{ addMsg }}</span>
      </div>
    </div>

    <div class="add-row">
      <button v-if="!showAdd" type="button" class="btn-secondary" @click="startAdd">
        + Add webhook
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'

type WebhookFormat = 'discord' | 'slack' | 'generic'
type WebhookEvent =
  | 'episode.publish'
  | 'episode.recording.scheduled'
  | 'episode.recording.moved'
  | 'episode.recording.cancelled'

const ALL_EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: 'episode.publish', label: 'A new episode goes live' },
  { value: 'episode.recording.scheduled', label: 'A recording is added to the calendar' },
  { value: 'episode.recording.moved', label: 'A scheduled recording moves' },
  { value: 'episode.recording.cancelled', label: 'A scheduled recording is removed' },
]

interface ApiWebhook {
  id: number
  scope: 'podcast' | 'network'
  scope_id: number
  name: string
  format: WebhookFormat
  enabled: boolean
  events: WebhookEvent[]
  url_host: string | null
}

interface EditableWebhook extends ApiWebhook {
  urlInput: string
  busy: boolean
  saving: boolean
  testing: boolean
  deleting: boolean
  msg: string
  msgOk: boolean
}

const props = defineProps<{ baseUrl: string }>()

const webhooks = ref<EditableWebhook[]>([])
const loadError = ref('')
const showAdd = ref(false)
const adding = ref(false)
const addMsg = ref('')

const newHook = reactive({
  name: '',
  url: '',
  format: 'generic' as WebhookFormat,
  enabled: true,
  events: [] as WebhookEvent[],
})

function decorate(raw: ApiWebhook): EditableWebhook {
  return {
    ...raw,
    urlInput: '',
    busy: false,
    saving: false,
    testing: false,
    deleting: false,
    msg: '',
    msgOk: false,
  }
}

async function load() {
  try {
    const data = await $fetch<ApiWebhook[]>(props.baseUrl)
    webhooks.value = data.map(decorate)
    loadError.value = ''
  } catch (err: unknown) {
    loadError.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Failed to load webhooks')
  }
}
onMounted(load)

function toggleEvent(wh: EditableWebhook, ev: WebhookEvent, checked: boolean) {
  if (checked && !wh.events.includes(ev)) {
    wh.events.push(ev)
  } else if (!checked) {
    wh.events = wh.events.filter((e) => e !== ev)
  }
}

function toggleNewEvent(ev: WebhookEvent, checked: boolean) {
  if (checked && !newHook.events.includes(ev)) {
    newHook.events.push(ev)
  } else if (!checked) {
    newHook.events = newHook.events.filter((e) => e !== ev)
  }
}

function clearMsgLater(wh: EditableWebhook, ms = 4000) {
  setTimeout(() => { wh.msg = '' }, ms)
}

async function saveHook(wh: EditableWebhook) {
  wh.busy = true
  wh.saving = true
  wh.msg = ''
  try {
    const body: Record<string, unknown> = {
      name: wh.name,
      format: wh.format,
      enabled: wh.enabled,
      events: wh.events,
    }
    if (wh.urlInput.trim() !== '') body.url = wh.urlInput.trim()
    const updated = await $fetch<ApiWebhook>(`${props.baseUrl}/${wh.id}`, {
      method: 'PATCH',
      body,
    })
    wh.url_host = updated.url_host
    wh.urlInput = ''
    wh.msg = 'Saved.'
    wh.msgOk = true
  } catch (err: unknown) {
    wh.msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Save failed')
    wh.msgOk = false
  } finally {
    wh.busy = false
    wh.saving = false
    clearMsgLater(wh)
  }
}

async function testHook(wh: EditableWebhook) {
  wh.busy = true
  wh.testing = true
  wh.msg = ''
  try {
    const body = wh.events.length > 0 ? { event: wh.events[0] } : {}
    await $fetch(`${props.baseUrl}/${wh.id}/test`, { method: 'POST', body })
    wh.msg = 'Test delivered.'
    wh.msgOk = true
  } catch (err: unknown) {
    wh.msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Test failed')
    wh.msgOk = false
  } finally {
    wh.busy = false
    wh.testing = false
    clearMsgLater(wh, 6000)
  }
}

async function deleteHook(wh: EditableWebhook) {
  if (!confirm(`Delete webhook${wh.name ? ` "${wh.name}"` : ''}? This cannot be undone.`)) return
  wh.busy = true
  wh.deleting = true
  wh.msg = ''
  try {
    await $fetch(`${props.baseUrl}/${wh.id}`, { method: 'DELETE' })
    webhooks.value = webhooks.value.filter((w) => w.id !== wh.id)
  } catch (err: unknown) {
    wh.msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Delete failed')
    wh.msgOk = false
    wh.busy = false
    wh.deleting = false
    clearMsgLater(wh)
  }
}

function startAdd() {
  showAdd.value = true
  newHook.name = ''
  newHook.url = ''
  newHook.format = 'generic'
  newHook.enabled = true
  newHook.events = []
  addMsg.value = ''
}

function cancelAdd() {
  showAdd.value = false
  addMsg.value = ''
}

async function createHook() {
  adding.value = true
  addMsg.value = ''
  try {
    const created = await $fetch<ApiWebhook>(props.baseUrl, {
      method: 'POST',
      body: {
        name: newHook.name,
        url: newHook.url,
        format: newHook.format,
        enabled: newHook.enabled,
        events: newHook.events,
      },
    })
    webhooks.value.push(decorate(created))
    showAdd.value = false
  } catch (err: unknown) {
    addMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Create failed')
  } finally {
    adding.value = false
  }
}
</script>

<style scoped>
.webhook-manager {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.empty {
  font-size: 0.9rem;
  color: #718096;
  font-style: italic;
}

.webhook-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1rem;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.add-card {
  border-style: dashed;
  border-color: #cbd5e0;
  background: #f7fafc;
}

.card-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.form-group.flex-grow {
  flex: 1 1 200px;
}

.form-group label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #4a5568;
}

.form-group input,
.form-group select {
  padding: 0.4rem 0.6rem;
  border: 1px solid #cbd5e0;
  border-radius: 5px;
  font-size: 0.9rem;
  background: #fff;
}

.hint {
  font-size: 0.78rem;
  color: #718096;
  margin: 0.15rem 0 0 0;
}

.events-fieldset {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.5rem 0.75rem 0.75rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.events-fieldset legend {
  font-size: 0.8rem;
  font-weight: 600;
  color: #4a5568;
  padding: 0 0.3rem;
}

.event-check {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.85rem;
  cursor: pointer;
}

.event-check input[type="checkbox"] {
  margin: 0;
}

.ev-name {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.8rem;
  color: #2d3748;
}

.ev-desc {
  color: #718096;
  font-size: 0.78rem;
}

.webhook-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-secondary,
.btn-danger {
  padding: 0.45rem 0.875rem;
  font-size: 0.85rem;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid;
}

.btn-secondary {
  background: #edf2f7;
  border-color: #e2e8f0;
  color: #4a5568;
}

.btn-secondary:hover:not(:disabled) {
  background: #e2e8f0;
}

.btn-danger {
  background: #fff5f5;
  border-color: #fc8181;
  color: #c53030;
}

.btn-danger:hover:not(:disabled) {
  background: #fed7d7;
}

.btn-secondary:disabled,
.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.webhook-msg {
  font-size: 0.82rem;
  padding: 0.3rem 0.6rem;
  border-radius: 5px;
}

.webhook-msg.ok {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
}

.webhook-msg.err {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
}

.add-row {
  display: flex;
  justify-content: flex-start;
}
</style>
