/** How the episode was (or will be) recorded. null = not specified. */
export type RecordingLocationType = 'in_person' | 'remote' | 'mixed'

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
  transcript_type: string | null
  chapters_url: string | null
  episode_type: string
  itunes_title: string | null
  itunes_author: string | null
  itunes_explicit: string | null
  season_name: string | null
  episode_display: string | null
  license_identifier: string | null
  license_url: string | null
  recording_starts_at: string | null
  recording_duration_minutes: number | null
  recording_location_type: RecordingLocationType | null
  recording_link: string | null
  created_at: string
  updated_at: string
}

export type EpisodeCreateInput = Omit<Episode, 'id' | 'podcast_id' | 'created_at' | 'updated_at'>
export type EpisodeUpdateInput = Partial<EpisodeCreateInput>

/**
 * The columns the episode-list page actually renders, plus `description` and
 * `tags`, which it searches over client-side.
 *
 * Sent as ?fields= so the list stops paying for the ~20 columns it never
 * touches — the full row is roughly 5x this, and most of the bulk is empty
 * strings whose JSON keys repeat once per episode. The server's default
 * projection is deliberately left alone: it's the contract the downstream
 * site sync reads.
 *
 * Anything new referenced in the list template has to be added here too;
 * EpisodeListItem makes forgetting a typecheck error rather than a cell that
 * silently renders undefined.
 */
export const EPISODE_LIST_FIELDS = [
  'id', 'title', 'description', 'tags',
  'episode_number', 'season_number', 'status', 'episode_type',
  'published_at', 'created_at',
  'recording_starts_at', 'recording_location_type', 'recording_link',
] as const

export type EpisodeListItem = Pick<Episode, typeof EPISODE_LIST_FIELDS[number]>

export function useEpisodes(podcastSlug: string) {
  const episodes = ref<EpisodeListItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const base = `/api/podcasts/${podcastSlug}/episodes`

  async function refresh(status?: string) {
    loading.value = true
    error.value = null
    try {
      const params: Record<string, string> = { fields: EPISODE_LIST_FIELDS.join(',') }
      if (status) params.status = status
      const data = await $fetch<EpisodeListItem[]>(base, { params })
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
