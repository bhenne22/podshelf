<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>Storage</h1>
      <p class="hint">Where audio files are uploaded for this podcast. Credentials are stored encrypted with your <code>PODSHELF_ENCRYPTION_KEY</code>.</p>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="testResult" class="test-result">
        <div class="test-summary">
          <strong>Connected.</strong>
          <span v-if="adapter === 'sftp'">
            Listed <code>{{ (testResult as SftpResult).remoteDir }}</code> —
            {{ (testResult as SftpResult).totalEntries }} entries total.
          </span>
          <span v-else>
            Listed bucket <code>{{ (testResult as S3Result).bucket }}</code> —
            {{ (testResult as S3Result).totalEntries }} objects total.
          </span>
        </div>
        <ul v-if="adapter === 'sftp' && (testResult as SftpResult).entries.length" class="entry-list">
          <li v-for="e in (testResult as SftpResult).entries" :key="e.name">
            <span class="entry-type">{{ e.type === 'dir' ? '📁' : e.type === 'link' ? '🔗' : '📄' }}</span>
            <span class="entry-name">{{ e.name }}</span>
            <span v-if="e.type === 'file'" class="entry-size">{{ formatSize(e.size) }}</span>
          </li>
        </ul>
        <ul v-else-if="adapter === 's3' && (testResult as S3Result).entries.length" class="entry-list">
          <li v-for="e in (testResult as S3Result).entries" :key="e.key">
            <span class="entry-type">📄</span>
            <span class="entry-name">{{ e.key }}</span>
            <span class="entry-size">{{ formatSize(e.size) }}</span>
          </li>
        </ul>
        <p v-else class="empty-listing">(directory is empty)</p>
      </div>

      <div class="form-section">
        <div class="form-group">
          <label>Adapter</label>
          <select v-model="adapter">
            <option value="sftp">SFTP</option>
            <option value="s3">S3 / Backblaze B2 / R2</option>
          </select>
        </div>

        <p v-if="current?.configured" class="status">
          <strong>Currently configured.</strong> Re-saving will overwrite existing credentials.
        </p>
      </div>

      <!-- SFTP form -->
      <form v-if="adapter === 'sftp'" @submit.prevent="saveSftp" class="form-section">
        <h2>SFTP</h2>
        <div class="form-row">
          <div class="form-group flex-2">
            <label>Host</label>
            <input v-model="sftp.host" type="text" placeholder="ssh.example.com" required />
          </div>
          <div class="form-group">
            <label>Port</label>
            <input v-model.number="sftp.port" type="number" min="1" max="65535" placeholder="22" />
          </div>
        </div>
        <div class="form-group">
          <label>Username</label>
          <input v-model="sftp.username" type="text" required />
        </div>
        <div class="form-group">
          <label>Auth method</label>
          <div class="radio-row">
            <label class="radio">
              <input type="radio" v-model="sftpAuthMode" value="key" /> Private key
            </label>
            <label class="radio">
              <input type="radio" v-model="sftpAuthMode" value="password" /> Password
            </label>
          </div>
        </div>
        <div v-if="sftpAuthMode === 'key'" class="form-group">
          <label>Private Key (PEM contents)</label>
          <textarea v-model="sftp.privateKey" rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..." />
          <p class="hint">Paste the contents of your private key file. Stored encrypted.</p>
        </div>
        <div v-if="sftpAuthMode === 'key'" class="form-group">
          <label>Passphrase <span class="hint">(only if your key is encrypted)</span></label>
          <input v-model="sftp.passphrase" type="password" autocomplete="off" />
        </div>
        <div v-else class="form-group">
          <label>Password</label>
          <input v-model="sftp.password" type="password" />
        </div>
        <div class="form-group">
          <label>Audio Remote Directory</label>
          <input v-model="sftp.remoteDir" type="text" placeholder="/home/user/public_html/podcast/audio" required />
        </div>
        <div class="form-group">
          <label>Audio Public URL Base</label>
          <input v-model="sftp.publicUrlBase" type="url" placeholder="https://example.com/podcast/audio" required />
          <p class="hint">Public URL that corresponds to the audio directory. Files become reachable at <code>{publicUrlBase}/{filename}</code>.</p>
        </div>
        <div class="form-group">
          <label>Artwork Remote Directory <span class="hint">(optional)</span></label>
          <input v-model="sftp.artworkRemoteDir" type="text" placeholder="/home/user/public_html/podcast/artwork" />
        </div>
        <div class="form-group">
          <label>Artwork Public URL Base <span class="hint">(required if artwork dir is set)</span></label>
          <input v-model="sftp.artworkPublicUrlBase" type="url" placeholder="https://example.com/podcast/artwork" />
          <p class="hint">Where uploaded podcast / episode artwork lives. Same SFTP credentials are used.</p>
        </div>
        <div class="form-group">
          <label>Test Against</label>
          <div class="radio-row">
            <label class="radio"><input type="radio" v-model="testKind" value="audio" /> Audio dir</label>
            <label class="radio"><input type="radio" v-model="testKind" value="artwork" /> Artwork dir</label>
          </div>
        </div>
        <div class="form-actions">
          <span v-if="saving" class="save-status saving">Saving…</span>
          <span v-else-if="justSaved" class="save-status ok">✓ Saved</span>
          <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
          <button type="button" class="btn-secondary" :disabled="testing" @click="testConnection">
            {{ testing ? 'Testing…' : 'Test Connection' }}
          </button>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save SFTP Config' }}
          </button>
        </div>
      </form>

      <!-- S3 form -->
      <form v-else @submit.prevent="saveS3" class="form-section">
        <h2>S3 / Backblaze B2 / R2</h2>
        <div class="form-row">
          <div class="form-group">
            <label>Endpoint</label>
            <input v-model="s3.endpoint" type="text" placeholder="(blank for AWS) or https://s3.us-west-004.backblazeb2.com" />
          </div>
          <div class="form-group">
            <label>Region</label>
            <input v-model="s3.region" type="text" placeholder="us-east-1" />
          </div>
        </div>
        <div class="form-group">
          <label>Access Key ID</label>
          <input v-model="s3.accessKeyId" type="text" required />
        </div>
        <div class="form-group">
          <label>Secret Access Key</label>
          <input v-model="s3.secretAccessKey" type="password" required />
        </div>
        <div class="form-group">
          <label>Bucket Name</label>
          <input v-model="s3.bucketName" type="text" required />
        </div>
        <div class="form-group">
          <label>Audio Public URL Base</label>
          <input v-model="s3.publicUrlBase" type="url" placeholder="https://f004.backblazeb2.com/file/your-bucket-name" required />
        </div>
        <div class="form-group">
          <label>Artwork Key Prefix <span class="hint">(optional, e.g. <code>artwork/</code>)</span></label>
          <input v-model="s3.artworkPrefix" type="text" placeholder="artwork/" />
          <p class="hint">Object key prefix used for podcast / episode artwork uploads in the same bucket.</p>
        </div>
        <div class="form-group">
          <label>Artwork Public URL Base <span class="hint">(falls back to audio URL base when blank)</span></label>
          <input v-model="s3.artworkPublicUrlBase" type="url" placeholder="https://example.com/artwork" />
        </div>
        <div class="form-group">
          <label>Test Against</label>
          <div class="radio-row">
            <label class="radio"><input type="radio" v-model="testKind" value="audio" /> Audio prefix</label>
            <label class="radio"><input type="radio" v-model="testKind" value="artwork" /> Artwork prefix</label>
          </div>
        </div>
        <div class="form-actions">
          <span v-if="saving" class="save-status saving">Saving…</span>
          <span v-else-if="justSaved" class="save-status ok">✓ Saved</span>
          <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
          <button type="button" class="btn-secondary" :disabled="testing" @click="testConnection">
            {{ testing ? 'Testing…' : 'Test Connection' }}
          </button>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save S3 Config' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const podcastSlug = route.params.slug as string

interface StorageDescription {
  adapter: 'sftp' | 's3'
  configured: boolean
  fields: Record<string, string | boolean | number>
}

const { data: current, refresh } = await useFetch<StorageDescription>(`/api/podcasts/${podcastSlug}/storage`)

const adapter = ref<'sftp' | 's3'>(current.value?.adapter || 'sftp')

const sftpAuthMode = ref<'key' | 'password'>('key')
const sftp = reactive({
  host: '',
  port: 22,
  username: '',
  privateKey: '',
  passphrase: '',
  password: '',
  remoteDir: '',
  publicUrlBase: '',
  artworkRemoteDir: '',
  artworkPublicUrlBase: '',
})

const s3 = reactive({
  endpoint: '',
  region: 'us-east-1',
  accessKeyId: '',
  secretAccessKey: '',
  bucketName: '',
  publicUrlBase: '',
  artworkPrefix: '',
  artworkPublicUrlBase: '',
})

const testKind = ref<'audio' | 'artwork'>('audio')

// Pre-populate non-secret fields from existing config
watch(current, (c) => {
  if (!c?.configured) return
  if (c.adapter === 'sftp') {
    sftp.host = String(c.fields.host || '')
    sftp.port = Number(c.fields.port || 22)
    sftp.username = String(c.fields.username || '')
    sftp.remoteDir = String(c.fields.remoteDir || '')
    sftp.publicUrlBase = String(c.fields.publicUrlBase || '')
    sftp.artworkRemoteDir = String(c.fields.artworkRemoteDir || '')
    sftp.artworkPublicUrlBase = String(c.fields.artworkPublicUrlBase || '')
    sftpAuthMode.value = c.fields.hasPrivateKey ? 'key' : 'password'
  } else {
    s3.endpoint = String(c.fields.endpoint || '')
    s3.region = String(c.fields.region || 'us-east-1')
    s3.bucketName = String(c.fields.bucketName || '')
    s3.publicUrlBase = String(c.fields.publicUrlBase || '')
    s3.artworkPrefix = String(c.fields.artworkPrefix || '')
    s3.artworkPublicUrlBase = String(c.fields.artworkPublicUrlBase || '')
  }
}, { immediate: true })

const saving = ref(false)
const justSaved = ref(false)
const testing = ref(false)
const successMsg = ref('')
const errorMsg = ref('')

interface SftpResult {
  ok: boolean
  remoteDir: string
  totalEntries: number
  entries: { name: string; type: 'file' | 'dir' | 'link' | 'other'; size: number; modifiedAt: number | null }[]
}
interface S3Result {
  ok: boolean
  bucket: string
  totalEntries: number
  entries: { key: string; size: number; modifiedAt: string | null }[]
}
const testResult = ref<SftpResult | S3Result | null>(null)

function formatSize(bytes: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

async function testConnection() {
  testing.value = true
  successMsg.value = ''
  errorMsg.value = ''
  testResult.value = null
  try {
    let config: Record<string, unknown>
    if (adapter.value === 'sftp') {
      config = {
        host: sftp.host,
        port: sftp.port,
        username: sftp.username,
        remoteDir: sftp.remoteDir,
        publicUrlBase: sftp.publicUrlBase,
        artworkRemoteDir: sftp.artworkRemoteDir || undefined,
        artworkPublicUrlBase: sftp.artworkPublicUrlBase || undefined,
      }
      if (sftpAuthMode.value === 'key' && sftp.privateKey) config.privateKey = sftp.privateKey
      if (sftpAuthMode.value === 'key' && sftp.passphrase) config.passphrase = sftp.passphrase
      if (sftpAuthMode.value === 'password' && sftp.password) config.password = sftp.password
    } else {
      config = { ...s3 }
      if (!s3.secretAccessKey) delete (config as { secretAccessKey?: string }).secretAccessKey
      if (!s3.artworkPrefix) delete (config as { artworkPrefix?: string }).artworkPrefix
      if (!s3.artworkPublicUrlBase) delete (config as { artworkPublicUrlBase?: string }).artworkPublicUrlBase
    }
    const result = await $fetch<SftpResult | S3Result>(`/api/podcasts/${podcastSlug}/storage/test`, {
      method: 'POST',
      body: { adapter: adapter.value, config, kind: testKind.value },
    })
    testResult.value = result
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Connection test failed'
  } finally {
    testing.value = false
  }
}

async function saveSftp() {
  saving.value = true
  successMsg.value = ''
  errorMsg.value = ''
  try {
    const config: Record<string, unknown> = {
      host: sftp.host,
      port: sftp.port,
      username: sftp.username,
      remoteDir: sftp.remoteDir,
      publicUrlBase: sftp.publicUrlBase,
    }
    if (sftp.artworkRemoteDir) config.artworkRemoteDir = sftp.artworkRemoteDir
    if (sftp.artworkPublicUrlBase) config.artworkPublicUrlBase = sftp.artworkPublicUrlBase
    if (sftpAuthMode.value === 'key') {
      config.privateKey = sftp.privateKey
      if (sftp.passphrase) config.passphrase = sftp.passphrase
    } else {
      config.password = sftp.password
    }

    await $fetch(`/api/podcasts/${podcastSlug}/storage`, {
      method: 'POST',
      body: { adapter: 'sftp', config },
    })
    successMsg.value = 'SFTP configuration saved.'
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 3500)
    sftp.privateKey = ''
    sftp.passphrase = ''
    sftp.password = ''
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function saveS3() {
  saving.value = true
  successMsg.value = ''
  errorMsg.value = ''
  try {
    const config: Record<string, unknown> = { ...s3 }
    if (!s3.artworkPrefix) delete config.artworkPrefix
    if (!s3.artworkPublicUrlBase) delete config.artworkPublicUrlBase
    await $fetch(`/api/podcasts/${podcastSlug}/storage`, {
      method: 'POST',
      body: { adapter: 's3', config },
    })
    successMsg.value = 'S3 configuration saved.'
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 3500)
    s3.secretAccessKey = ''
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to save'
  } finally {
    saving.value = false
  }
}

useHead({ title: 'Storage — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 760px; margin: 0 auto; padding: 2rem 1.25rem; }

h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #1a202c; }
.hint { font-size: 0.85rem; color: #718096; margin-bottom: 1.5rem; }
.hint code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
  margin-bottom: 1.25rem;
}
.form-section h2 {
  margin: 0 0 1.25rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group { margin-bottom: 1rem; }
.form-group:last-child { margin-bottom: 0; }
.form-row { display: flex; gap: 1rem; }
.form-row .form-group { flex: 1; }
.form-row .form-group.flex-2 { flex: 2; }

label { display: block; font-size: 0.875rem; font-weight: 500; color: #4a5568; margin-bottom: 0.375rem; }

.radio-row { display: flex; gap: 1rem; }
.radio { display: flex; align-items: center; gap: 0.4rem; font-weight: normal; }

input[type="text"], input[type="url"], input[type="password"], input[type="number"], select, textarea {
  display: block; width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  font-family: system-ui, sans-serif;
  background: white;
  outline: none;
}
input:focus, select:focus, textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
}
textarea { resize: vertical; font-family: ui-monospace, monospace; font-size: 0.82rem; }

.status {
  font-size: 0.85rem;
  color: #2f855a;
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  padding: 0.6rem 0.9rem;
  border-radius: 6px;
  margin-top: 0.75rem;
}

.form-actions { display: flex; justify-content: flex-end; align-items: center; gap: 0.75rem; padding-top: 0.5rem; }

.save-status { font-size: 0.875rem; font-weight: 500; }
.save-status.saving { color: #718096; }
.save-status.ok { color: #2f855a; }
.save-status.err { color: #c53030; max-width: 380px; }
.btn-primary {
  padding: 0.6rem 1.5rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.9rem; font-weight: 500; cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
button:disabled { opacity: 0.6; cursor: not-allowed; }

.success-msg {
  background: #f0fff4; border: 1px solid #9ae6b4;
  color: #276749; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}
.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}

.test-result {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  font-size: 0.9rem;
}
.test-summary {
  color: #2f855a;
  margin-bottom: 0.75rem;
}
.test-summary strong { color: #276749; }
.test-summary code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
  color: #4a5568;
}
.entry-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: ui-monospace, monospace;
  font-size: 0.82rem;
  border-top: 1px solid #f0f4f8;
}
.entry-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid #f0f4f8;
}
.entry-list li:last-child { border-bottom: none; }
.entry-type { width: 1.25rem; }
.entry-name { flex: 1; color: #2d3748; word-break: break-all; }
.entry-size { color: #718096; font-size: 0.78rem; }
.empty-listing { color: #718096; font-style: italic; margin: 0; }

.btn-secondary {
  padding: 0.6rem 1.25rem;
  background: white; color: #4a5568;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem; cursor: pointer;
  margin-right: 0.5rem;
}
.btn-secondary:hover:not(:disabled) { background: #f7fafc; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .form-section { padding: 1rem; }
  /* 16px input font prevents iOS Safari from zooming on focus. */
  input[type="text"],
  input[type="url"],
  input[type="number"],
  input[type="password"],
  select,
  textarea {
    font-size: 16px;
    padding: 0.625rem 0.75rem;
    min-height: 44px;
  }
  textarea { min-height: auto; }
  .form-row { flex-direction: column; gap: 0; }
  .form-row .form-group { flex: 1 1 auto; }
  .radio-row { flex-wrap: wrap; gap: 0.625rem 1rem; }
  .radio-row .radio { min-height: 32px; display: flex; align-items: center; gap: 0.4rem; }
  /* Pin native radio/checkbox size — they balloon at the larger label
     font otherwise. Explicit inline-block keeps them on the same line as
     their label text on mobile. */
  .radio-row input[type="radio"],
  input[type="checkbox"] {
    display: inline-block;
    width: 18px;
    height: 18px;
    min-height: 0;
    padding: 0;
    margin: 0;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .form-actions {
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: stretch;
  }
  .form-actions .btn-secondary,
  .form-actions .btn-primary { flex: 1 1 auto; min-width: 0; }
  .form-actions .save-status { flex-basis: 100%; order: -1; }
}
</style>
