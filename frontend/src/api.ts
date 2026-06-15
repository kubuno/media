import { api } from '@kubuno/sdk'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MediaLibrary {
  id: string
  name: string
  lib_type: 'movies' | 'shows' | 'music' | 'home_videos'
  path: string
  is_shared: boolean
  item_count: number
  scan_status: 'idle' | 'scanning' | 'error'
  last_scan_at: string | null
  source_type: 'filesystem' | 'files_folder'
  files_folder_id: string | null
  files_owner_id: string | null
}

export interface FilesFolderItem {
  id: string
  owner_id: string
  path: string
  name: string
  owner_email: string
  owner_display_name: string | null
}

export interface CastMember {
  name:          string
  character?:    string
  profile_path?: string
}

export interface CrewMember {
  name: string
  job:  string
}

export interface Movie {
  id: string
  title: string
  original_title:    string | null
  tagline:           string | null
  overview:          string | null
  release_date:      string | null
  runtime_mins:      number | null
  poster_path:       string | null
  backdrop_path:     string | null
  vote_average:      number | null
  vote_count:        number | null
  genres:            string[]
  meta_status:       string
  duration_secs:     number
  video_codec:       string | null
  audio_codec:       string | null
  resolution_w:      number | null
  resolution_h:      number | null
  original_language: string | null
  cast:              CastMember[] | null
  crew:              CrewMember[] | null
  content_rating:    string | null
  trailer_key:       string | null
  poster_urls:       string[]
  file_path:         string | null
}

export interface TvShow {
  id: string
  name: string
  overview: string | null
  first_air_date: string | null
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number | null
  genres: string[]
  season_count: number
  episode_count: number
  status: string | null
  meta_status: string
}

export interface TvEpisode {
  id: string
  episode_number: number
  name: string | null
  overview: string | null
  still_path: string | null
  duration_secs: number | null
  air_date: string | null
}

export interface Artist {
  id: string
  name: string
  image_path: string | null
  genres: string[]
  album_count: number
  track_count: number
  biography: string | null
  begin_date: string | null
  country: string | null
}

export interface Album {
  id: string
  title: string
  release_year: number | null
  cover_path: string | null
  genres: string[]
  track_count: number
  duration_secs: number
  artist_id: string | null
  label: string | null
}

export interface Track {
  id: string
  title: string
  track_number: number | null
  duration_secs: number
  album_id: string | null
  artist_id: string | null
  codec: string | null
  bitrate: number | null
  play_count: number
}

export interface Playlist {
  id: string
  name: string
  description: string | null
  cover_path: string | null
  track_count: number
  duration_secs: number
  is_public: boolean
}

export interface VideoProgress {
  position_secs: number
  duration_secs: number
  percent_played: number
  is_watched: boolean
}

// ── TMDB image helper ─────────────────────────────────────────────────────────

const TMDB_IMG = 'https://image.tmdb.org/t/p'

export function posterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' = 'w342'): string | null {
  if (!path) return null
  if (path.startsWith('http')) return path
  return `${TMDB_IMG}/${size}${path}`
}

export function backdropUrl(path: string | null): string | null {
  if (!path) return null
  if (path.startsWith('http')) return path
  return `${TMDB_IMG}/w780${path}`
}

export function formatDuration(secs: number): string {
  if (!secs) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── API ───────────────────────────────────────────────────────────────────────

export const mediaApi = {
  // Libraries
  async getLibraries(): Promise<MediaLibrary[]> {
    const { data } = await api.get('/media/libraries')
    return data.libraries ?? []
  },
  async createLibrary(dto: {
    name: string
    lib_type: string
    path?: string
    is_shared?: boolean
    source_type?: 'filesystem' | 'files_folder'
    files_folder_id?: string
    files_owner_id?: string
  }): Promise<MediaLibrary> {
    const { data } = await api.post('/media/libraries', dto)
    return data
  },
  async getFilesFolders(): Promise<FilesFolderItem[]> {
    const { data } = await api.get('/media/libraries/files-folders')
    return data.folders ?? []
  },
  async updateLibrary(id: string, dto: { name?: string; path?: string; is_shared?: boolean }): Promise<MediaLibrary> {
    const { data } = await api.patch(`/media/libraries/${id}`, dto)
    return data
  },
  async deleteLibrary(id: string): Promise<void> {
    await api.delete(`/media/libraries/${id}`)
  },
  async scanLibrary(id: string): Promise<void> {
    await api.post(`/media/libraries/${id}/scan`)
  },
  async scanAllLibraries(): Promise<void> {
    await api.post('/media/libraries/scan-all')
  },
  async getScanStatus(id: string): Promise<{ status: string; files_found?: number; files_processed?: number; files_added?: number }> {
    const { data } = await api.get(`/media/libraries/${id}/scan/status`)
    return data
  },

  // Movies
  async getMovies(params?: { limit?: number; offset?: number; q?: string }): Promise<Movie[]> {
    const { data } = await api.get('/media/movies', { params })
    return data.movies ?? []
  },
  async getRecentMovies(): Promise<Movie[]> {
    const { data } = await api.get('/media/movies/recent')
    return data.movies ?? []
  },
  async getContinueWatching(): Promise<Movie[]> {
    const { data } = await api.get('/media/movies/continue')
    return data.movies ?? []
  },
  async getMovie(id: string): Promise<Movie> {
    const { data } = await api.get(`/media/movies/${id}`)
    return data
  },

  // Shows
  async getShows(params?: { limit?: number; offset?: number; q?: string }): Promise<TvShow[]> {
    const { data } = await api.get('/media/shows', { params })
    return data.shows ?? []
  },
  async getShow(id: string): Promise<TvShow> {
    const { data } = await api.get(`/media/shows/${id}`)
    return data
  },
  async getEpisodes(showId: string, season: number): Promise<TvEpisode[]> {
    const { data } = await api.get(`/media/shows/${showId}/seasons/${season}/episodes`)
    return data.episodes ?? []
  },

  // Artists
  async getArtists(params?: { limit?: number; offset?: number; q?: string }): Promise<Artist[]> {
    const { data } = await api.get('/media/artists', { params })
    return data.artists ?? []
  },
  async getArtist(id: string): Promise<{
    id: string; name: string; biography: string | null; image_path: string | null
    genres: string[] | null; country: string | null; artist_type: string | null; album_count: number
    albums: Array<{ id: string; title: string; release_year: number | null; cover_path: string | null; album_type: string | null; track_count: number }>
    top_tracks: Array<{ id: string; title: string; duration_secs: number; play_count: number; album_id: string | null }>
  }> {
    const { data } = await api.get(`/media/artists/${id}`)
    return data
  },

  // Albums
  async getAlbums(params?: { limit?: number; offset?: number; q?: string }): Promise<Album[]> {
    const { data } = await api.get('/media/albums', { params })
    return data.albums ?? []
  },
  async getRecentAlbums(): Promise<Album[]> {
    const { data } = await api.get('/media/albums/recent')
    return data.albums ?? []
  },
  async getAlbum(id: string): Promise<{ album: Album; tracks: Track[] }> {
    const { data } = await api.get(`/media/albums/${id}`)
    // Backend returns flat { id, title, ..., tracks: [] }, normalize to { album, tracks }
    const { tracks, ...albumFields } = data
    return { album: albumFields as Album, tracks: tracks ?? [] }
  },

  // Tracks
  async getLikedTracks(): Promise<Track[]> {
    const { data } = await api.get('/media/tracks/liked')
    return data.tracks ?? []
  },
  async getRecentlyPlayed(): Promise<Track[]> {
    const { data } = await api.get('/media/tracks/recently-played')
    return data.tracks ?? []
  },
  async toggleLike(id: string): Promise<boolean> {
    const { data } = await api.post(`/media/tracks/${id}/like`)
    return data.liked
  },

  // Playlists
  async getPlaylists(): Promise<Playlist[]> {
    const { data } = await api.get('/media/playlists')
    return data.playlists ?? []
  },
  async createPlaylist(dto: { name: string; description?: string; is_public?: boolean }): Promise<{ id: string }> {
    const { data } = await api.post('/media/playlists', dto)
    return data
  },
  async updatePlaylist(id: string, dto: { name?: string; description?: string; is_public?: boolean }): Promise<void> {
    await api.patch(`/media/playlists/${id}`, dto)
  },
  async deletePlaylist(id: string): Promise<void> {
    await api.delete(`/media/playlists/${id}`)
  },
  async getPlaylist(id: string): Promise<{
    id: string; name: string; track_count: number; duration_secs: number
    tracks: Array<{ id: string; title: string; duration_secs: number; artist_name: string | null; album_title: string | null; cover_path: string | null; position: number }>
  }> {
    const { data } = await api.get(`/media/playlists/${id}`)
    return data
  },

  // Progress
  async saveProgress(itemType: string, itemId: string, positionSecs: number, durationSecs: number): Promise<void> {
    await api.post(`/media/progress/${itemType}/${itemId}`, {
      position_secs: positionSecs,
      duration_secs: durationSecs,
    })
  },
  async getProgress(itemType: string, itemId: string): Promise<VideoProgress | null> {
    try {
      const { data } = await api.get(`/media/progress/${itemType}/${itemId}`)
      return data
    } catch {
      return null
    }
  },

  // Streaming
  streamUrl(id: string): string {
    return `/api/v1/media/stream/${id}/direct`
  },
  hlsMasterUrl(id: string): string {
    return `/api/v1/media/stream/${id}/master.m3u8`
  },
  audioStreamUrl(id: string): string {
    return `/api/v1/media/audio/${id}/stream`
  },

  // Search
  async search(q: string): Promise<{ movies: Movie[]; shows: TvShow[]; artists: Artist[]; albums: Album[]; tracks: Track[] }> {
    const { data } = await api.get('/media/search', { params: { q } })
    return data
  },

  // Movie actions
  async markWatched(id: string): Promise<{ is_watched: boolean }> {
    const { data } = await api.post(`/media/movies/${id}/mark-watched`)
    return data
  },
  async refreshMetadata(id: string): Promise<void> {
    await api.post(`/media/movies/${id}/refresh-meta`)
  },
  async dissociate(id: string): Promise<void> {
    await api.post(`/media/movies/${id}/dissociate`)
  },
  async getWatchlistStatus(id: string): Promise<{ in_watchlist: boolean }> {
    const { data } = await api.get(`/media/movies/${id}/watchlist-status`)
    return data
  },
  async getPlayHistory(id: string): Promise<{ has_progress: boolean; position_secs?: number; duration_secs?: number; percent_played?: number; is_watched?: boolean; last_played_at?: string }> {
    const { data } = await api.get(`/media/movies/${id}/play-history`)
    return data
  },

  // Watchlist
  async getWatchlist(): Promise<Array<{ item_type: string; item_id: string; title: string | null; poster_path: string | null; added_at: string }>> {
    const { data } = await api.get('/media/watchlist')
    return data.items ?? []
  },
  async addToWatchlist(itemType: 'movie' | 'show', itemId: string): Promise<void> {
    await api.post('/media/watchlist', { item_type: itemType, item_id: itemId })
  },
  async removeFromWatchlist(itemType: 'movie' | 'show', itemId: string): Promise<void> {
    await api.delete(`/media/watchlist/${itemType}/${itemId}`)
  },
  async setPoster(id: string, posterUrl: string): Promise<void> {
    await api.post(`/media/movies/${id}/set-poster`, { poster_url: posterUrl })
  },

  // Admin settings
  async getAdminSettings(): Promise<{ metadata_language?: string }> {
    const { data } = await api.get('/media/admin/settings')
    return data
  },
  async patchAdminSettings(dto: { metadata_language?: string }): Promise<void> {
    await api.patch('/media/admin/settings', dto)
  },
  async triggerEnrich(): Promise<{ queued: number; message: string }> {
    const { data } = await api.post('/media/admin/enrich')
    return data
  },
}
