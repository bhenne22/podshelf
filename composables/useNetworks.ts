export interface NetworkListItem {
  id: number
  slug: string
  title: string
  description: string | null
  podcast_count: number
}

export interface NetworkPodcast {
  id: number
  slug: string
  title: string
  image_url: string | null
  timezone?: string
  status?: string
  position: number
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

  async function getNetwork(slug: string): Promise<NetworkDetail> {
    return await $fetch<NetworkDetail>(`/api/networks/${slug}`)
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

  return { listNetworks, getNetwork, getUpcomingEpisodes }
}
