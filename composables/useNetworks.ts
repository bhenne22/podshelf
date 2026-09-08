export interface NetworkListItem {
  id: number
  slug: string
  title: string
  description: string | null
  podcast_count: number
}

export type NetworkPropertyType = 'string' | 'boolean' | 'number' | 'url' | 'color'

export interface NetworkPropertyDefinition {
  id: number
  key: string
  label: string
  description: string | null
  type: NetworkPropertyType
  required: boolean | number
  position: number
  created_at?: string
  updated_at?: string
}

export type NetworkPropertyValue = string | number | boolean | null
export type NetworkPropertyValues = Record<string, NetworkPropertyValue>

export interface NetworkPropertyEntry {
  podcast_id: number
  podcast_slug: string
  key: string
  value: NetworkPropertyValue
  type: NetworkPropertyType
}

export interface NetworkPodcast {
  id: number
  slug: string
  title: string
  image_url: string | null
  timezone?: string
  status?: string
  position: number
  properties?: NetworkPropertyValues
}

export interface NetworkDetail {
  id: number
  slug: string
  title: string
  description: string | null
  created_at: string
  updated_at: string
  podcasts: NetworkPodcast[]
}

export interface NetworkUpcomingEpisode {
  episode_id: number
  episode_title: string
  episode_slug: string
  // 'draft' only appears when ?include=recording brings in episodes that
  // have a recording slot but no publish state.
  status: 'draft' | 'scheduled' | 'published'
  published_at: string | null
  episode_type: string
  podcast_id: number
  podcast_slug: string
  podcast_title: string
  podcast_image_url: string | null
  podcast_timezone: string
  // Only present when ?include=recording was passed.
  recording_starts_at?: string | null
  recording_duration_minutes?: number | null
}

/** A row from GET /api/networks/[slug]/episodes — the whole back catalogue. */
export interface NetworkEpisode {
  episode_id: number
  episode_title: string
  episode_slug: string
  status: 'draft' | 'scheduled' | 'published'
  published_at: string | null
  season_number: number | null
  episode_number: number | null
  episode_type: string
  recording_starts_at: string | null
  podcast_id: number
  podcast_slug: string
  podcast_title: string
  podcast_image_url: string | null
  podcast_timezone: string
}

export interface NetworkEpisodesParams {
  /** Title substring, or an exact episode id when all digits. */
  q?: string
  podcast?: string
  status?: 'draft' | 'scheduled' | 'published'
  limit?: number
  offset?: number
}

export interface NetworkEpisodesResult {
  episodes: NetworkEpisode[]
  total: number
  limit: number
  offset: number
}

export interface UpcomingEpisodesParams {
  from?: string
  to?: string
  excludePodcast?: string
  /** Comma-separated, e.g. "recording" — opt in to recording events. */
  include?: string
}

export function useNetworks() {
  async function listNetworks(opts: { podcastSlug?: string } = {}): Promise<NetworkListItem[]> {
    const params: Record<string, string> = {}
    if (opts.podcastSlug) params.podcastSlug = opts.podcastSlug
    return await $fetch<NetworkListItem[]>('/api/networks', { params })
  }

  async function getNetwork(
    slug: string,
    opts: { includeProperties?: boolean } = {},
  ): Promise<NetworkDetail> {
    const params: Record<string, string> = {}
    if (opts.includeProperties) params.include = 'properties'
    return await $fetch<NetworkDetail>(`/api/networks/${slug}`, { params })
  }

  async function getUpcomingEpisodes(
    slug: string,
    params: UpcomingEpisodesParams = {},
  ): Promise<NetworkUpcomingEpisode[]> {
    const res = await $fetch<{ episodes: NetworkUpcomingEpisode[] }>(
      `/api/networks/${slug}/upcoming-episodes`,
      { params: params as Record<string, string> },
    )
    return res.episodes
  }

  async function listEpisodes(
    slug: string,
    params: NetworkEpisodesParams = {},
  ): Promise<NetworkEpisodesResult> {
    return await $fetch<NetworkEpisodesResult>(
      `/api/networks/${slug}/episodes`,
      { params: params as Record<string, string | number> },
    )
  }

  async function listPropertyDefinitions(slug: string): Promise<NetworkPropertyDefinition[]> {
    return await $fetch<NetworkPropertyDefinition[]>(
      `/api/networks/${slug}/property-definitions`,
    )
  }

  async function listProperties(slug: string): Promise<NetworkPropertyEntry[]> {
    const res = await $fetch<{ properties: NetworkPropertyEntry[] }>(
      `/api/networks/${slug}/properties`,
    )
    return res.properties
  }

  return {
    listNetworks,
    getNetwork,
    getUpcomingEpisodes,
    listEpisodes,
    listPropertyDefinitions,
    listProperties,
  }
}
