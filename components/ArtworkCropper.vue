<template>
  <Teleport to="body">
    <div v-if="open" class="ac-overlay" @click.self="cancel">
      <div class="ac-modal">
        <div class="ac-header">
          <h3>Crop to {{ outputSize }}×{{ outputSize }}</h3>
          <button class="ac-close" type="button" @click="cancel" aria-label="Close">×</button>
        </div>
        <p class="ac-hint">Drag to position. Scroll or use the slider to zoom. The square overlay is what gets uploaded.</p>

        <div
          class="ac-frame"
          ref="frameEl"
          @pointerdown="onPointerDown"
          @wheel.prevent="onWheel"
        >
          <img
            v-if="src"
            ref="imgEl"
            :src="src"
            class="ac-img"
            :style="imgStyle"
            draggable="false"
            @load="onImageLoad"
          />
        </div>

        <div class="ac-controls">
          <span class="ac-zoom-label">Zoom</span>
          <input
            type="range"
            class="ac-zoom"
            :min="1"
            :max="4"
            step="0.01"
            v-model.number="zoomMul"
          />
          <span class="ac-zoom-val">{{ (zoomMul * 100).toFixed(0) }}%</span>
        </div>

        <p v-if="errorMsg" class="ac-error">{{ errorMsg }}</p>

        <div class="ac-footer">
          <button class="ac-btn-secondary" type="button" @click="cancel">Cancel</button>
          <button class="ac-btn-primary" type="button" :disabled="!imageReady || saving" @click="save">
            {{ saving ? 'Cropping…' : 'Use Cropped Image' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    open: boolean
    /** Object URL or data URL for the source image. */
    src: string | null
    /** Original filename — used to derive the output filename. */
    filename: string
    /** Output edge length in px. Defaults to Apple Podcasts artwork minimum. */
    outputSize?: number
  }>(),
  { outputSize: 1400 },
)

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'cropped', payload: { blob: Blob; filename: string }): void
}>()

const OUTPUT_SIZE = computed(() => props.outputSize)
const FRAME_SIZE = 420   // px on-screen viewport size

const frameEl = ref<HTMLDivElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)

const naturalW = ref(0)
const naturalH = ref(0)
const minScale = ref(1)
const zoomMul = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const imageReady = ref(false)
const saving = ref(false)
const errorMsg = ref('')

const scale = computed(() => minScale.value * zoomMul.value)
const imgStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
  width: `${naturalW.value}px`,
  height: `${naturalH.value}px`,
}))

function reset() {
  zoomMul.value = 1
  imageReady.value = false
  saving.value = false
  errorMsg.value = ''
}

watch(() => props.open, (v) => {
  if (v) reset()
})

function onImageLoad() {
  const img = imgEl.value
  if (!img) return
  naturalW.value = img.naturalWidth
  naturalH.value = img.naturalHeight
  if (naturalW.value < OUTPUT_SIZE.value || naturalH.value < OUTPUT_SIZE.value) {
    errorMsg.value = `Source is ${naturalW.value}×${naturalH.value}; output will be upscaled to ${OUTPUT_SIZE.value}×${OUTPUT_SIZE.value}. For best results upload an image at least ${OUTPUT_SIZE.value}px on each side.`
  }
  // Cover-style minimum scale — image always fills the frame so the output
  // is always real pixels, never letterboxed.
  minScale.value = Math.max(FRAME_SIZE / naturalW.value, FRAME_SIZE / naturalH.value)
  // Centered start.
  offsetX.value = (FRAME_SIZE - naturalW.value * scale.value) / 2
  offsetY.value = (FRAME_SIZE - naturalH.value * scale.value) / 2
  imageReady.value = true
}

function clampOffsets() {
  const dispW = naturalW.value * scale.value
  const dispH = naturalH.value * scale.value
  // Image must always cover the frame: top-left can't go positive, bottom-right can't go negative.
  if (offsetX.value > 0) offsetX.value = 0
  if (offsetY.value > 0) offsetY.value = 0
  if (offsetX.value < FRAME_SIZE - dispW) offsetX.value = FRAME_SIZE - dispW
  if (offsetY.value < FRAME_SIZE - dispH) offsetY.value = FRAME_SIZE - dispH
}

// Re-clamp whenever the zoom changes — and re-center on the previous focal
// point so zoom feels anchored to the middle of the frame.
watch(scale, (newS, oldS) => {
  if (!imageReady.value || !oldS) return
  const frameCenterX = FRAME_SIZE / 2
  const frameCenterY = FRAME_SIZE / 2
  // Image-coord under frame center before zoom change
  const ix = (frameCenterX - offsetX.value) / oldS
  const iy = (frameCenterY - offsetY.value) / oldS
  // Recompute offset so the same image-coord is still under frame center
  offsetX.value = frameCenterX - ix * newS
  offsetY.value = frameCenterY - iy * newS
  clampOffsets()
})

let dragStartX = 0
let dragStartY = 0
let dragOffsetX = 0
let dragOffsetY = 0
let dragging = false

function onPointerDown(e: PointerEvent) {
  if (!imageReady.value) return
  dragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragOffsetX = offsetX.value
  dragOffsetY = offsetY.value
  ;(e.target as Element).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  offsetX.value = dragOffsetX + (e.clientX - dragStartX)
  offsetY.value = dragOffsetY + (e.clientY - dragStartY)
  clampOffsets()
}

function onPointerUp() {
  dragging = false
  window.removeEventListener('pointermove', onPointerMove)
}

function onWheel(e: WheelEvent) {
  const delta = -e.deltaY * 0.002
  const next = Math.min(4, Math.max(1, zoomMul.value + delta))
  zoomMul.value = next
}

function deriveOutputFilename(orig: string): string {
  const dot = orig.lastIndexOf('.')
  const base = dot > 0 ? orig.slice(0, dot) : orig
  // Always emit JPEG since we're rasterizing through canvas; .png/.webp inputs lose alpha intentionally.
  return `${base}-${OUTPUT_SIZE.value}.jpg`
}

async function save() {
  if (!imageReady.value || !imgEl.value) return
  saving.value = true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE.value
    canvas.height = OUTPUT_SIZE.value
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')

    // Window of source-pixels currently visible in the frame.
    const srcX = -offsetX.value / scale.value
    const srcY = -offsetY.value / scale.value
    const srcW = FRAME_SIZE / scale.value
    const srcH = FRAME_SIZE / scale.value

    ctx.drawImage(imgEl.value, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_SIZE.value, OUTPUT_SIZE.value)

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/jpeg', 0.92)
    })

    emit('cropped', { blob, filename: deriveOutputFilename(props.filename) })
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Crop failed'
  } finally {
    saving.value = false
  }
}

function cancel() {
  emit('cancel')
}
</script>

<style scoped>
.ac-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 1200;
}
.ac-modal {
  background: white;
  border-radius: 12px;
  width: min(520px, 95vw);
  max-height: 95vh;
  display: flex; flex-direction: column;
  padding: 1.1rem 1.1rem 0.875rem;
  font-family: system-ui, sans-serif;
}
.ac-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 0.25rem;
}
.ac-header h3 { margin: 0; font-size: 1.1rem; }
.ac-close {
  background: none; border: none;
  font-size: 1.5rem; color: #718096; cursor: pointer;
  padding: 0; line-height: 1;
  width: 40px; height: 40px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px;
}
.ac-close:hover { color: #1a202c; background: #f7fafc; }
.ac-hint { color: #718096; font-size: 0.78rem; margin: 0 0 0.625rem; }

.ac-frame {
  width: 420px; height: 420px;
  max-width: 100%;
  background: #1a202c;
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  margin: 0 auto;
  touch-action: none;
  cursor: grab;
  user-select: none;
}
.ac-frame:active { cursor: grabbing; }
.ac-img {
  position: absolute; top: 0; left: 0;
  pointer-events: none;
  -webkit-user-drag: none;
}

.ac-controls {
  display: flex; align-items: center; gap: 0.625rem;
  margin: 0.625rem 0 0.25rem;
}
.ac-zoom-label { font-size: 0.78rem; color: #4a5568; min-width: 3rem; }
.ac-zoom { flex: 1; }
.ac-zoom-val { font-size: 0.74rem; color: #718096; min-width: 3rem; text-align: right; font-variant-numeric: tabular-nums; }

.ac-error {
  padding: 0.5rem 0.75rem;
  background: #fffaf0; border: 1px solid #f6ad55; color: #b7791f;
  border-radius: 6px; font-size: 0.78rem;
  margin: 0.5rem 0 0;
}

.ac-footer {
  display: flex; justify-content: flex-end; gap: 0.5rem;
  margin-top: 0.75rem; padding-top: 0.75rem;
  border-top: 1px solid #f0f4f8;
}
.ac-btn-secondary, .ac-btn-primary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
}
.ac-btn-secondary {
  background: white;
  border: 1px solid #e2e8f0;
  color: #4a5568;
}
.ac-btn-secondary:hover { background: #f7fafc; }
.ac-btn-primary {
  background: #4c51bf;
  border: 1px solid #4c51bf;
  color: white;
  font-weight: 500;
}
.ac-btn-primary:hover:not(:disabled) { background: #434190; }
.ac-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }

@media (max-width: 480px) {
  .ac-modal { padding: 0.875rem; }
  .ac-frame { width: min(100%, 360px); height: min(100vw, 360px); }
}
</style>
