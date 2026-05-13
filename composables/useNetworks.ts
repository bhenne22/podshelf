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
  status: 'scheduled' | 'published'
  published_at: string
  episode_type: string
  podcast_id: number
  podcast_slug: string
  podcast_title: string
  podcast_image_url: string | null
  podcast_timezone: string
}

export interface UpcomingEpisodesParams {
  from?: string
  to?: string
  excludePodcast?: string
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
    listPropertyDefinitions,
    listProperties,
  }
}
