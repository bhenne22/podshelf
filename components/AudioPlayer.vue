<template>
  <div class="audio-player" v-if="audioUrl">
    <div class="player-title">{{ title }}</div>
    <div class="player-controls">
      <button class="play-btn" @click="togglePlay" :aria-label="playing ? 'Pause' : 'Play'">
        <span v-if="!playing">&#9654;</span>
        <span v-else>&#9646;&#9646;</span>
      </button>
      <div class="time-display">{{ formatTime(currentTime) }}</div>
      <div class="seekbar-wrapper" @click="seek">
        <div class="seekbar-track">
          <div class="seekbar-fill" :style="{ width: progress + '%' }"></div>
        </div>
      </div>
      <div class="time-display">{{ formatTime(duration) }}</div>
      <div class="volume-wrapper">
        <button class="volume-btn" @click="toggleMute" :aria-label="muted ? 'Unmute' : 'Mute'">
          <span v-if="muted">🔇</span>
          <span v-else>🔊</span>
        </button>
        <input
          type="range"
          class="volume-slider"
          min="0"
          max="1"
          step="0.05"
          v-model.number="volume"
          @input="setVolume"
          aria-label="Volume"
        />
      </div>
    </div>
    <audio
      ref="audioEl"
      :src="audioUrl"
      preload="metadata"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @ended="playing = false"
    ></audio>
  </div>
  <div v-else class="player-unavailable">
    <p>Audio not available for this episode.</p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  audioUrl: string | null
  title?: string
}>()

const audioEl = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const muted = ref(false)

const progress = computed(() => {
  if (!duration.value) return 0
  return (currentTime.value / duration.value) * 100
})

function togglePlay() {
  if (!audioEl.value) return
  if (playing.value) {
    audioEl.value.pause()
    playing.value = false
  } else {
    audioEl.value.play()
    playing.value = true
  }
}

function onTimeUpdate() {
  if (audioEl.value) {
    currentTime.value = audioEl.value.currentTime
  }
}

function onLoadedMetadata() {
  if (audioEl.value) {
    duration.value = audioEl.value.duration
  }
}

function seek(event: MouseEvent) {
  if (!audioEl.value || !duration.value) return
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / rect.width
  audioEl.value.currentTime = ratio * duration.value
}

function toggleMute() {
  if (!audioEl.value) return
  muted.value = !muted.value
  audioEl.value.muted = muted.value
}

function setVolume() {
  if (!audioEl.value) return
  audioEl.value.volume = volume.value
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.audio-player {
  background: #1a202c;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  color: white;
  margin: 1.5rem 0;
}

.player-title {
  font-size: 0.875rem;
  font-weight: 500;
  opacity: 0.75;
  margin-bottom: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.play-btn {
  background: #667eea;
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  color: white;
  font-size: 1rem;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.1s;
}

.play-btn:hover {
  background: #5a67d8;
  transform: scale(1.05);
}

.time-display {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
  min-width: 3rem;
  text-align: center;
  flex-shrink: 0;
}

.seekbar-wrapper {
  flex: 1;
  cursor: pointer;
  padding: 0.5rem 0;
}

.seekbar-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
}

.seekbar-fill {
  height: 100%;
  background: #667eea;
  border-radius: 2px;
  transition: width 0.1s linear;
}

.volume-wrapper {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
}

.volume-btn {
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  line-height: 1;
}

.volume-slider {
  width: 70px;
  accent-color: #667eea;
}

.player-unavailable {
  background: #f7fafc;
  border: 1px dashed #e2e8f0;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
  color: #718096;
  font-size: 0.9rem;
  margin: 1.5rem 0;
}

@media (max-width: 480px) {
  .volume-wrapper {
    display: none;
  }
}
</style>
