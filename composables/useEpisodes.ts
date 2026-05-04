export interface Episode {
  id: number
  podcast_id: number
  title: string
  slug: string
  episode_number: number | null
  season_number: number | null
  description: string | null
  audio_url: string | null
  audio_filename: string | null
  audio_size_bytes: number | null
  audio_duration_seconds: number | null
  image_url: string | null
  image_filename: string | null
  published_at: string | null
  status: string
  tags: string | null
  transcript_path: string | null
  episode_type: string
  created_at: string
  updated_at: string
}

export type EpisodeCreateInput = Omit<Episode, 'id' | 'podcast_id' | 'created_at' | 'updated_at'>
export type EpisodeUpdateInput = Partial<EpisodeCreateInput>

export function useEpisodes(podcastSlug: string) {
  const episodes = ref<Episode[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const base = `/api/podcasts/${podcastSlug}/episodes`

  async function refresh(status?: string) {
    loading.value = true
    error.value = null
    try {
      const params = status ? { status } : {}
      const data = await $fetch<Episode[]>(base, { params })
      episodes.value = data
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to load episodes'
    } finally {
      loading.value = false
    }
  }

  async function createEpisode(input: Partial<EpisodeCreateInput>): Promise<Episode> {
    const episode = await $fetch<Episode>(base, {
      method: 'POST',
      body: input,
    })
    episodes.value.unshift(episode)
    return episode
  }

  async function updateEpisode(id: number, input: EpisodeUpdateInput): Promise<Episode> {
    const updated = await $fetch<Episode>(`${base}/${id}`, {
      method: 'PATCH',
      body: input,
    })
    const index = episodes.value.findIndex((e) => e.id === id)
    if (index !== -1) {
      episodes.value[index] = updated
    }
    return updated
  }

  async function deleteEpisode(id: number): Promise<void> {
    await $fetch(`${base}/${id}`, { method: 'DELETE' })
    episodes.value = episodes.value.filter((e) => e.id !== id)
  }

  return {
    episodes,
    loading,
    error,
    refresh,
    createEpisode,
    updateEpisode,
    deleteEpisode,
  }
}
