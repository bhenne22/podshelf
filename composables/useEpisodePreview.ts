import type { Ref } from 'vue'
import type { Episode } from './useEpisodes'

interface Options {
  defaultChaptersOpen?: boolean
  defaultTranscriptOpen?: boolean
  defaultNotesOpen?: boolean
}

/**
 * Audio + chapters + transcript plumbing shared by the per-episode preview
 * page and the inline EpisodePreviewCard component.
 *
 * The consumer owns the layout (template + styles); this composable owns:
 *   - the `<audio>` ref + currentTime tracking
 *   - lazy-loading the chapters / transcript files via the proxy endpoint
 *   - active-chapter / active-cue computeds for highlighting
 *   - auto-scrolling the active cue into view within its own pane
 *   - seek-and-play behavior on click
 */
export function useEpisodePreview(
  episode: Ref<Episode>,
  podcastSlug: string,
  options: Options = {},
) {
  const audioEl = ref<HTMLAudioElement | null>(null)
  const cuesContainer = ref<HTMLElement | null>(null)

  const chaptersOpen = ref(!!options.defaultChaptersOpen)
  const transcriptOpen = ref(!!options.defaultTranscriptOpen)
  const notesOpen = ref(!!options.defaultNotesOpen)

  const chapters = ref<Chapter[]>([])
  const chaptersLoading = ref(false)
  const chaptersError = ref('')

  const transcript = ref<TranscriptPayload | null>(null)
  const transcriptLoading = ref(false)
  const transcriptError = ref('')

  const currentTime = ref(0)
  const lastScrolledIdx = ref(-1)

  const activeChapterIdx = computed(() => {
    if (!chapters.value.length) return -1
    let idx = -1
    for (let i = 0; i < chapters.value.length; i++) {
      if (chapters.value[i].startTime <= currentTime.value) idx = i
      else break
    }
    return idx
  })

  const activeCueIdx = computed(() => {
    const cues = transcript.value?.cues || []
    if (!cues.length) return -1
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i]
      if (currentTime.value >= c.startTime && currentTime.value < c.endTime) return i
    }
    const last = cues.length - 1
    if (currentTime.value >= cues[last].endTime) return last
    return -1
  })

  function onTimeupdate() {
    if (audioEl.value) currentTime.value = audioEl.value.currentTime
  }

  function seek(t: number) {
    if (!audioEl.value) return
    audioEl.value.currentTime = Math.max(0, t)
    if (audioEl.value.paused) {
      audioEl.value.play().catch(() => { /* user-gesture rules can still block */ })
    }
  }

  async function loadChapters() {
    if (!episode.value.chapters_url) return
    chaptersLoading.value = true
    chaptersError.value = ''
    try {
      const text = await $fetch<string>(
        `/api/podcasts/${podcastSlug}/episodes/${episode.value.id}/asset`,
        { query: { kind: 'chapters' }, responseType: 'text' },
      )
      chapters.value = parseChaptersJson(text)
    } catch (err: unknown) {
      chaptersError.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || (err instanceof Error ? err.message : 'Failed to load chapters')
    } finally {
      chaptersLoading.value = false
    }
  }

  async function loadTranscript() {
    if (!episode.value.transcript_path) return
    transcriptLoading.value = true
    transcriptError.value = ''
    try {
      const response = await fetch(
        `/api/podcasts/${podcastSlug}/episodes/${episode.value.id}/asset?kind=transcript`,
        { credentials: 'same-origin' },
      )
      if (!response.ok) throw new Error(`Server returned ${response.status}`)
      const ct = response.headers.get('content-type')
      const text = await response.text()
      transcript.value = parseTranscript(text, ct || episode.value.transcript_type)
    } catch (err: unknown) {
      transcriptError.value = err instanceof Error ? err.message : 'Failed to load transcript'
    } finally {
      transcriptLoading.value = false
    }
  }

  // Lazy-load each panel the first time it opens.
  watch(chaptersOpen, (open) => {
    if (open && !chapters.value.length && !chaptersLoading.value && !chaptersError.value) {
      loadChapters()
    }
  })
  watch(transcriptOpen, (open) => {
    if (open && !transcript.value && !transcriptLoading.value && !transcriptError.value) {
      loadTranscript()
    }
  })

  // If the consumer asked for panels to start open (per-episode page does),
  // kick off the loads after mount — the watchers above only fire on changes.
  if (chaptersOpen.value || transcriptOpen.value) {
    onMounted(() => {
      if (chaptersOpen.value && !chapters.value.length) loadChapters()
      if (transcriptOpen.value && !transcript.value) loadTranscript()
    })
  }

  // When the active cue advances, scroll it into view inside its own pane.
  // We use getBoundingClientRect math instead of `target.offsetTop` because
  // offsetTop is relative to the nearest *positioned* ancestor, which often
  // isn't the cues container — that mismatch caused the scroll position to
  // overshoot and land minutes ahead of the active cue.
  watch(activeCueIdx, (idx) => {
    if (idx < 0 || !transcriptOpen.value || idx === lastScrolledIdx.value) return
    lastScrolledIdx.value = idx
    nextTick(() => {
      const container = cuesContainer.value
      if (!container) return
      const target = container.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null
      if (!target) return
      const cRect = container.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()
      const targetTopWithin = tRect.top - cRect.top + container.scrollTop
      const visibleTop = container.scrollTop
      const visibleBottom = visibleTop + container.clientHeight
      if (targetTopWithin < visibleTop || targetTopWithin + tRect.height > visibleBottom) {
        container.scrollTo({
          top: Math.max(0, targetTopWithin - container.clientHeight / 3),
          behavior: 'smooth',
        })
      }
    })
  })

  return {
    audioEl, cuesContainer,
    chaptersOpen, chapters, chaptersLoading, chaptersError, activeChapterIdx,
    transcriptOpen, transcript, transcriptLoading, transcriptError, activeCueIdx,
    notesOpen,
    currentTime,
    onTimeupdate, seek,
  }
}
