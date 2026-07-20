import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Star, Clapperboard, Calendar, Loader2, Bookmark,
  MoreHorizontal, RefreshCw, Target, Lock, Unlock, Layers,
} from 'lucide-react'
import { Button, MenuDropdown, useMenuDropdown, type MenuItem } from '@ui'
import { mediaApi, posterUrl, type TvEpisode } from '../api'
import { useMediaVideoStore } from '../store/mediaVideoStore'
import { useIdentifyStore } from '../store/identifyStore'

interface ShowCast { name: string; character?: string; profile_path?: string | null }

interface ShowDetail {
  id: string
  name: string
  original_name: string | null
  overview: string | null
  tagline: string | null
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number | null
  genres: string[]
  networks: string[] | null
  status: string | null
  first_air_date: string | null
  last_air_date: string | null
  season_count: number
  episode_count: number
  meta_locked?: boolean
  ratings?: { imdb?: string; rotten_tomatoes?: string; metacritic?: string }
  cast: ShowCast[] | null
  seasons: Array<{
    id: string; season_number: number; name: string | null
    air_date: string | null; poster_path: string | null; episode_count: number
  }>
}

const STATUS_FR: Record<string, string> = {
  'Ended': 'Terminée', 'Running': 'En cours', 'Returning Series': 'En cours',
  'Canceled': 'Annulée', 'In Development': 'En développement', 'To Be Determined': 'À déterminer',
}

function fmtDate(d: string | null): string | null {
  if (!d) return null
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Episode row ───────────────────────────────────────────────────────────────

function EpisodeRow({ ep, showName, seasonNumber }: {
  ep: TvEpisode; showName: string; seasonNumber: number
}) {
  const openPlayer = useMediaVideoStore(s => s.open)
  const still = ep.still_path ? posterUrl(ep.still_path, 'w342') : null
  const mins = ep.duration_secs ? Math.round(ep.duration_secs / 60) : null

  const play = () => {
    const label = `${showName} — S${String(seasonNumber).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}${ep.name ? ` · ${ep.name}` : ''}`
    openPlayer(ep.id, label)
  }

  return (
    <div className="group flex gap-4 p-3 rounded-xl border border-border bg-surface-1 hover:bg-surface-2 transition-colors">
      <button onClick={play}
        className="relative flex-shrink-0 w-40 aspect-video rounded-lg overflow-hidden bg-surface-3 flex items-center justify-center"
        title="Lire l'épisode">
        {still
          ? <img src={still} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <Clapperboard className="w-8 h-8 text-text-tertiary" />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#2f7dff' }}>
            <Play className="w-5 h-5 fill-white text-white ml-0.5" />
          </span>
        </span>
      </button>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-text-tertiary flex-shrink-0">E{String(ep.episode_number).padStart(2, '0')}</span>
          <p className="text-sm font-semibold text-text-primary truncate">{ep.name ?? `Épisode ${ep.episode_number}`}</p>
        </div>
        <p className="text-xs text-text-tertiary mt-0.5">
          {[fmtDate(ep.air_date), mins ? `${mins} min` : null].filter(Boolean).join(' · ')}
        </p>
        {ep.overview && (
          <p className="text-xs text-text-secondary mt-1.5 leading-relaxed line-clamp-2">{ep.overview}</p>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShowDetailPage() {
  const { id }       = useParams<{ id: string }>()
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const openPlayer   = useMediaVideoStore(s => s.open)
  const openIdentify = useIdentifyStore(s => s.open)
  const metaMenu     = useMenuDropdown()
  const [season, setSeason] = useState<number | null>(null)
  const [inWatchlist, setInWatchlist] = useState<boolean | null>(null)

  const { data: show, isLoading } = useQuery<ShowDetail>({
    queryKey: ['media', 'show', id],
    queryFn:  () => mediaApi.getShow(id!) as unknown as Promise<ShowDetail>,
    enabled:  !!id,
  })

  // Seasons with episodes only; default to the first one.
  const seasons = (show?.seasons ?? []).filter(s => s.episode_count > 0)
  const activeSeason = season ?? seasons[0]?.season_number ?? null

  const { data: episodes = [], isLoading: epsLoading } = useQuery<TvEpisode[]>({
    queryKey: ['media', 'episodes', id, activeSeason],
    queryFn:  () => mediaApi.getEpisodes(id!, activeSeason!),
    enabled:  !!id && activeSeason != null,
  })

  useEffect(() => {
    if (!id) return
    mediaApi.getWatchlist()
      .then(items => setInWatchlist(items.some(i => i.item_type === 'show' && i.item_id === id)))
      .catch(() => {})
  }, [id])

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
  }
  if (!show) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary">
        <Clapperboard className="w-16 h-16 text-text-tertiary" />
        <p>Série introuvable.</p>
        <button onClick={() => navigate('/media/watch/shows')} className="text-primary hover:underline text-sm">
          Retour aux séries
        </button>
      </div>
    )
  }

  const poster   = posterUrl(show.poster_path)
  const backdrop = posterUrl(show.backdrop_path, 'w500') ?? poster
  const firstYear = show.first_air_date ? new Date(show.first_air_date).getFullYear() : null
  const lastYear  = show.last_air_date ? new Date(show.last_air_date).getFullYear() : null
  const yearRange = firstYear
    ? (show.status === 'Ended' && lastYear && lastYear !== firstYear ? `${firstYear} – ${lastYear}` : `${firstYear}`)
    : null
  const cast = (show.cast ?? []).slice(0, 12)
  const locked = show.meta_locked === true

  const refreshViews = () => {
    void queryClient.invalidateQueries({ queryKey: ['media', 'show', id] })
    void queryClient.invalidateQueries({ queryKey: ['media', 'shows'] })
    void queryClient.invalidateQueries({ queryKey: ['media', 'episodes', id] })
  }

  const playFirst = () => {
    if (episodes.length > 0 && activeSeason != null) {
      const ep = episodes[0]
      openPlayer(ep.id, `${show.name} — S${String(activeSeason).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}`)
    }
  }

  const toggleWatchlist = () => {
    if (!id) return
    const next = !(inWatchlist ?? false)
    setInWatchlist(next)
    const action = next
      ? mediaApi.addToWatchlist('show', id)
      : mediaApi.removeFromWatchlist('show', id)
    action.catch(() => setInWatchlist(!next))
  }

  const metaItems: MenuItem[] = [
    { type: 'action', icon: <Target className="w-4 h-4" />, label: 'Identifier…',
      onClick: () => openIdentify({ kind: 'show', id: show.id, name: show.name }) },
    { type: 'action', icon: <RefreshCw className="w-4 h-4" />, label: 'Rafraîchir les métadonnées',
      disabled: locked,
      onClick: () => {
        void mediaApi.refreshShowMeta(show.id).then(() => { setTimeout(refreshViews, 6000) }).catch(() => {})
      } },
    { type: 'separator' },
    { type: 'action', icon: locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />,
      label: locked ? 'Déverrouiller les métadonnées' : 'Verrouiller les métadonnées',
      onClick: () => { void mediaApi.lockMeta('shows', show.id, !locked).then(refreshViews) } },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-0">
      {/* Back button */}
      <div className="px-6 pt-5 pb-0 flex-shrink-0">
        <button
          onClick={() => navigate('/media/watch/shows')}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Séries
        </button>
      </div>

      {/* Hero */}
      <div className="relative flex-shrink-0 mx-6 mt-4 rounded-2xl overflow-hidden bg-surface-2" style={{ minHeight: 220 }}>
        {backdrop && (
          <img src={backdrop} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        <div className="relative flex items-end gap-6 p-6 min-h-[220px]">
          {poster && (
            <div className="hidden sm:block w-28 h-40 rounded-xl overflow-hidden shadow-2xl flex-shrink-0">
              <img src={poster} alt={show.name} className="w-full h-full object-cover" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            {show.tagline && <p className="text-white/70 text-sm italic mb-1">{show.tagline}</p>}
            <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-1">{show.name}</h1>
            {show.original_name && show.original_name !== show.name && (
              <p className="text-white/60 text-sm mb-2">{show.original_name}</p>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80 mb-3">
              {yearRange && (
                <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{yearRange}</span>
              )}
              <span className="flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                {show.season_count} saison{show.season_count > 1 ? 's' : ''} · {show.episode_count} ép.
              </span>
              {show.vote_average && show.vote_average > 0 && (
                <span className="flex items-center gap-1" title="Note TMDB">
                  <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                  {show.vote_average.toFixed(1)}
                </span>
              )}
              {show.ratings?.rotten_tomatoes && (
                <span title="Rotten Tomatoes"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/85 text-white text-xs font-semibold">
                  🍅 {show.ratings.rotten_tomatoes}
                </span>
              )}
              {show.ratings?.imdb && (
                <span title="IMDb" className="px-1.5 py-0.5 rounded bg-yellow-400/90 text-black text-xs font-bold">
                  IMDb {show.ratings.imdb}
                </span>
              )}
              {show.status && (
                <span className="px-2 py-0.5 rounded border border-white/40 text-white/90 text-xs">
                  {STATUS_FR[show.status] ?? show.status}
                </span>
              )}
            </div>

            {/* Genres + networks */}
            {(show.genres.length > 0 || (show.networks?.length ?? 0) > 0) && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {show.genres.map(g => (
                  <span key={g} className="px-2.5 py-0.5 rounded-full bg-white/10 text-white/90 text-xs border border-white/20">{g}</span>
                ))}
                {(show.networks ?? []).map(n => (
                  <span key={n} className="px-2.5 py-0.5 rounded-full bg-primary/30 text-white text-xs border border-primary/40">{n}</span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button icon={<Play className="w-4 h-4 fill-white" />} onClick={playFirst}
                disabled={episodes.length === 0} className="px-6">
                Lire
              </Button>
              <button
                onClick={toggleWatchlist}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full font-medium text-sm border transition-colors ${
                  inWatchlist ? 'bg-primary text-white border-primary' : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                }`}
              >
                <Bookmark className="w-4 h-4" fill={inWatchlist ? 'currentColor' : 'none'} />
                Ma liste
              </button>
              <button
                onClick={metaMenu.open}
                aria-label="Plus d'options"
                className="flex items-center px-3 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full border border-white/20 transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {metaMenu.isOpen && metaMenu.pos && (
                <MenuDropdown pos={metaMenu.pos} onClose={metaMenu.close} items={metaItems} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="px-6 py-6 space-y-6 flex-1">
        {show.overview && (
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-2">Synopsis</h2>
            <p className="text-text-primary text-sm leading-relaxed max-w-3xl">{show.overview}</p>
          </section>
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">Distribution</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
              {cast.map((m, i) => (
                <div key={i} className="flex-shrink-0 w-24 text-center">
                  <div className="w-24 h-24 rounded-full overflow-hidden bg-surface-2 mx-auto mb-2 flex items-center justify-center">
                    {m.profile_path
                      ? <img src={m.profile_path.startsWith('http') ? m.profile_path : posterUrl(m.profile_path, 'w185')!} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
                      : <span className="text-2xl text-text-tertiary font-bold">{m.name.charAt(0)}</span>}
                  </div>
                  <p className="text-xs font-medium text-text-primary leading-tight truncate">{m.name}</p>
                  {m.character && <p className="text-xs text-text-tertiary leading-tight truncate">{m.character}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Seasons + episodes */}
        <section>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">Épisodes</h2>
            {seasons.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {seasons.map(s => (
                  <button key={s.id} onClick={() => setSeason(s.season_number)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      s.season_number === activeSeason
                        ? 'bg-primary text-white'
                        : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
                    }`}>
                    {s.name?.trim() || `Saison ${s.season_number}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {epsLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
          ) : episodes.length === 0 ? (
            <p className="text-sm text-text-tertiary py-6">Aucun épisode dans cette saison.</p>
          ) : (
            <div className="space-y-2 max-w-3xl">
              {episodes.map(ep => (
                <EpisodeRow key={ep.id} ep={ep} showName={show.name} seasonNumber={activeSeason!} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
