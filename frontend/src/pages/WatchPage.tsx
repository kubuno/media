import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Film, Clapperboard, Clock, Play, Star,
  Loader2, Film as FilmIcon, ChevronRight, Library, Bookmark,
  RefreshCw, Target, Home, Tv, Info, X,
} from 'lucide-react'
import { mediaApi, posterUrl, backdropUrl, formatDuration, type Movie, type TvShow } from '../api'
import { useMediaSearchStore } from '../store/mediaSearchStore'
import { useIdentifyStore } from '../store/identifyStore'
import { useMediaVideoStore } from '../store/mediaVideoStore'
import { DARK_PAGE } from '../darkTheme'
import MediaLibrariesPanel from '../MediaLibrariesPanel'
import { Button, MenuDropdown, type MenuDropdownPos, type MenuItem } from '@ui'
import MovieContextMenu, { type ContextMenuPosition } from '../MovieContextMenu'

// ── Poster card ───────────────────────────────────────────────────────────────

function MovieCard({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  const poster = posterUrl(movie.poster_path)
  const year   = movie.release_date ? new Date(movie.release_date).getFullYear() : null
  const [ctxMenu, setCtxMenu] = useState<ContextMenuPosition | null>(null)

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div onClick={onClick} onContextMenu={handleContextMenu} className="group cursor-pointer">
        <div className="aspect-[2/3] rounded-xl relative overflow-hidden shadow-lg ring-1 ring-white/5 group-hover:ring-blue-400/40 group-hover:shadow-2xl transition-all duration-300"
             style={{ background: 'rgba(255,255,255,0.05)' }}>
          {poster
            ? <img src={poster} alt={movie.title} className="w-full h-full object-cover group-hover:scale-[1.07] transition-transform duration-500" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center"><FilmIcon className="w-12 h-12 text-white/30" /></div>
          }
          {/* cinematic bottom gradient + meta on hover */}
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          {movie.vote_average && movie.vote_average > 0 && (
            <div className="absolute top-2 left-2 bg-black/75 backdrop-blur-sm text-white text-[11px] font-semibold rounded-md px-1.5 py-0.5 flex items-center gap-1 ring-1 ring-white/10">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              {movie.vote_average.toFixed(1)}
            </div>
          )}
          <button
            onClick={e => { e.stopPropagation(); onClick() }}
            className="absolute bottom-3 right-3 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 hover:scale-110"
            style={{ background: '#2f7dff' }}
            title="Lire">
            <Play className="w-5 h-5 fill-white ml-0.5" />
          </button>
        </div>
        <div className="pt-2.5 px-0.5">
          <p className="text-sm font-semibold text-text-primary truncate" title={movie.title}>{movie.title}</p>
          <p className="text-xs text-text-tertiary mt-0.5">{[year, movie.runtime_mins ? `${movie.runtime_mins} min` : null].filter(Boolean).join(' · ') || 'Film'}</p>
        </div>
      </div>

      {ctxMenu && (
        <MovieContextMenu movie={movie} position={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </>
  )
}

function ShowCard({ show, onClick }: { show: TvShow; onClick: () => void }) {
  const poster = posterUrl(show.poster_path)
  const year   = show.first_air_date ? new Date(show.first_air_date).getFullYear() : null
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  const openIdentify = useIdentifyStore(s => s.open)
  const menuItems: MenuItem[] = [
    { type: 'action', icon: <Play className="w-4 h-4" />, label: 'Ouvrir', onClick },
    { type: 'action', icon: <Bookmark className="w-4 h-4" />, label: 'Ajouter à ma liste', onClick: () => { mediaApi.addToWatchlist('show', show.id).catch(() => {}) } },
    { type: 'separator' },
    { type: 'action', icon: <Target className="w-4 h-4" />, label: 'Identifier…',
      onClick: () => openIdentify({ kind: 'show', id: show.id, name: show.name }) },
    { type: 'action', icon: <RefreshCw className="w-4 h-4" />, label: 'Rafraîchir les métadonnées',
      onClick: () => { mediaApi.refreshShowMeta(show.id).catch(() => {}) } },
  ]

  return (
    <>
    <div onClick={onClick} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ top: e.clientY, left: e.clientX }) }}
      className="group cursor-pointer">
      <div className="aspect-[2/3] rounded-xl relative overflow-hidden shadow-lg ring-1 ring-white/5 group-hover:ring-blue-400/40 group-hover:shadow-2xl transition-all duration-300"
           style={{ background: 'rgba(255,255,255,0.05)' }}>
        {poster
          ? <img src={poster} alt={show.name} className="w-full h-full object-cover group-hover:scale-[1.07] transition-transform duration-500" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center"><Clapperboard className="w-12 h-12 text-white/30" /></div>
        }
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        {show.vote_average && show.vote_average > 0 && (
          <div className="absolute top-2 left-2 bg-black/75 backdrop-blur-sm text-white text-[11px] font-semibold rounded-md px-1.5 py-0.5 flex items-center gap-1 ring-1 ring-white/10">
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            {show.vote_average.toFixed(1)}
          </div>
        )}
        <button onClick={e => { e.stopPropagation(); onClick() }}
          className="absolute bottom-3 right-3 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 hover:scale-110"
          style={{ background: '#2f7dff' }} title="Ouvrir">
          <Play className="w-5 h-5 fill-white ml-0.5" />
        </button>
      </div>
      <div className="pt-2.5 px-0.5">
        <p className="text-sm font-semibold text-text-primary truncate" title={show.name}>{show.name}</p>
        <p className="text-xs text-text-tertiary mt-0.5">
          {[year, show.season_count > 0 ? `${show.season_count} saison${show.season_count > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || 'Série'}
        </p>
      </div>
    </div>
    {ctx && <MenuDropdown theme="dark" pos={ctx} onClose={() => setCtx(null)} items={menuItems} />}
    </>
  )
}

// ── Continue watching card ────────────────────────────────────────────────────

function ContinueCard({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  const poster = posterUrl(movie.poster_path, 'w185')

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer flex gap-3 p-2 rounded-lg hover:bg-surface-2 transition-colors"
    >
      <div className="w-16 h-24 flex-shrink-0 rounded overflow-hidden bg-surface-2 relative">
        {poster
          ? <img src={poster} alt={movie.title} className="w-full h-full object-cover" />
          : <FilmIcon className="absolute inset-0 m-auto w-6 h-6 text-text-tertiary" />
        }
      </div>
      <div className="flex-1 min-w-0 py-1">
        <p className="text-sm font-medium text-text-primary truncate">{movie.title}</p>
        <p className="text-xs text-text-tertiary mt-1">{formatDuration(movie.duration_secs)}</p>
        <div className="mt-2 h-1 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full" style={{ width: '35%' }} />
        </div>
        <p className="text-xs text-text-tertiary mt-1">35% visionné</p>
      </div>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, onMore }: { title: string; onMore?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {onMore && (
        <button onClick={onMore} className="text-sm text-primary flex items-center gap-0.5 hover:underline">
          Tout voir <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-text-tertiary mb-4">{icon}</div>
      <p className="text-text-primary font-medium">{title}</p>
      <p className="text-text-secondary text-sm mt-1 max-w-xs">{subtitle}</p>
    </div>
  )
}

// ── Tab: Films ────────────────────────────────────────────────────────────────

function MoviesTab() {
  const navigate = useNavigate()
  const search = useMediaSearchStore(s => s.query)

  const { data: movies = [], isLoading } = useQuery({
    queryKey: ['media', 'movies', search],
    queryFn:  () => mediaApi.getMovies({ q: search || undefined, limit: 100 }),
  })

  const { data: recent = [] } = useQuery({
    queryKey: ['media', 'movies', 'recent'],
    queryFn:  mediaApi.getRecentMovies,
    enabled:  !search,
  })

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
  }

  if (!isLoading && movies.length === 0 && !search) {
    return (
      <EmptyState
        icon={<Film className="w-16 h-16" />}
        title="Aucun film"
        subtitle="Créez une bibliothèque « Films » et lancez un scan pour détecter vos fichiers vidéo."
      />
    )
  }

  // The home tab carries the "recently added" rows — this tab is the full grid.
  void recent

  return (
    <div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {movies.map(movie => (
          <MovieCard key={movie.id} movie={movie} onClick={() => navigate(`/media/watch/movie/${movie.id}`)} />
        ))}
      </div>
    </div>
  )
}

// ── Tab: Accueil ──────────────────────────────────────────────────────────────

/** Horizontal, scrollable media row. */
function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-text-primary mb-3">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
        {children}
      </div>
    </section>
  )
}

function HomeTab() {
  const navigate   = useNavigate()
  const openPlayer = useMediaVideoStore(s => s.open)

  const { data: continueMovies = [] } = useQuery({
    queryKey: ['media', 'movies', 'continue'],
    queryFn:  mediaApi.getContinueWatching,
  })
  const { data: recent = [], isLoading: recentLoading } = useQuery({
    queryKey: ['media', 'movies', 'recent'],
    queryFn:  mediaApi.getRecentMovies,
  })
  const { data: shows = [] } = useQuery({
    queryKey: ['media', 'shows', 'recent-home'],
    queryFn:  () => mediaApi.getShows({ limit: 15, sort: 'recent' }),
  })
  const { data: watchlist = [] } = useQuery({
    queryKey: ['media', 'watchlist'],
    queryFn:  mediaApi.getWatchlist,
  })

  const hero: Movie | null = continueMovies[0] ?? recent[0] ?? null
  const heroResume = continueMovies.length > 0 && hero?.id === continueMovies[0]?.id
  const heroBackdrop = hero ? (backdropUrl(hero.backdrop_path) ?? posterUrl(hero.poster_path, 'w500')) : null

  if (recentLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
  }

  if (!hero && shows.length === 0 && watchlist.length === 0) {
    return (
      <EmptyState
        icon={<Film className="w-16 h-16" />}
        title="Bibliothèque vide"
        subtitle="Créez une bibliothèque Films ou Séries via le bouton « Bibliothèques » et lancez un scan."
      />
    )
  }

  return (
    <div>
      {/* Featured hero */}
      {hero && (
        <div className="relative rounded-2xl overflow-hidden mb-8 min-h-[260px] flex items-end"
             style={{ background: 'rgba(255,255,255,0.04)' }}>
          {heroBackdrop && (
            <img src={heroBackdrop} alt="" className="absolute inset-0 w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <div className="relative p-6 max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">
              {heroResume ? 'Reprendre la lecture' : 'À la une'}
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight mb-2">{hero.title}</h2>
            <div className="flex items-center gap-3 text-sm text-white/75 mb-3">
              {hero.release_date && <span>{new Date(hero.release_date).getFullYear()}</span>}
              {hero.vote_average && hero.vote_average > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />{hero.vote_average.toFixed(1)}
                </span>
              )}
              {hero.duration_secs > 0 && <span>{formatDuration(hero.duration_secs)}</span>}
            </div>
            {hero.overview && (
              <p className="text-sm text-white/70 leading-relaxed line-clamp-2 mb-4">{hero.overview}</p>
            )}
            <div className="flex items-center gap-3">
              <Button icon={<Play className="w-4 h-4 fill-white" />} onClick={() => openPlayer(hero.id, hero.title)}>
                {heroResume ? 'Reprendre' : 'Lire'}
              </Button>
              <button
                onClick={() => navigate(`/media/watch/movie/${hero.id}`)}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full font-medium text-sm border border-white/20 transition-colors"
              >
                <Info className="w-4 h-4" />
                Fiche
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reprendre */}
      {continueMovies.length > 0 && (
        <Row title="Reprendre">
          {continueMovies.map(m => (
            <div key={m.id} className="w-72 flex-shrink-0">
              <ContinueCard movie={m} onClick={() => navigate(`/media/watch/movie/${m.id}`)} />
            </div>
          ))}
        </Row>
      )}

      {/* Recently added */}
      {recent.length > 0 && (
        <Row title="Récemment ajoutés">
          {recent.map(m => (
            <div key={m.id} className="w-[150px] flex-shrink-0">
              <MovieCard movie={m} onClick={() => navigate(`/media/watch/movie/${m.id}`)} />
            </div>
          ))}
        </Row>
      )}

      {/* TV shows */}
      {shows.length > 0 && (
        <Row title="Séries">
          {shows.map(s => (
            <div key={s.id} className="w-[150px] flex-shrink-0">
              <ShowCard show={s} onClick={() => navigate(`/media/watch/show/${s.id}`)} />
            </div>
          ))}
        </Row>
      )}

      {/* Ma liste */}
      {watchlist.length > 0 && (
        <Row title="Ma liste">
          {watchlist.map(w => (
            <div key={`${w.item_type}-${w.item_id}`} className="w-[150px] flex-shrink-0 group cursor-pointer"
                 onClick={() => navigate(w.item_type === 'show' ? `/media/watch/show/${w.item_id}` : `/media/watch/movie/${w.item_id}`)}>
              <div className="aspect-[2/3] rounded-xl overflow-hidden shadow-lg ring-1 ring-white/5 group-hover:ring-blue-400/40 transition-all"
                   style={{ background: 'rgba(255,255,255,0.05)' }}>
                {posterUrl(w.poster_path)
                  ? <img src={posterUrl(w.poster_path)!} alt={w.title ?? ''} className="w-full h-full object-cover group-hover:scale-[1.07] transition-transform duration-500" loading="lazy" />
                  : <div className="w-full h-full flex items-center justify-center"><Bookmark className="w-10 h-10 text-white/30" /></div>}
              </div>
              <p className="text-sm font-semibold text-text-primary truncate pt-2 px-0.5">{w.title}</p>
            </div>
          ))}
        </Row>
      )}
    </div>
  )
}

// ── Tab: Ma liste ─────────────────────────────────────────────────────────────

function WatchlistTab() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media', 'watchlist'],
    queryFn:  mediaApi.getWatchlist,
  })

  const remove = (itemType: string, itemId: string) => {
    void mediaApi.removeFromWatchlist(itemType as 'movie' | 'show', itemId)
      .then(() => qc.invalidateQueries({ queryKey: ['media', 'watchlist'] }))
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Bookmark className="w-16 h-16" />}
        title="Votre liste est vide"
        subtitle="Ajoutez des films et séries à votre liste depuis leur fiche ou leur menu contextuel."
      />
    )
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {items.map(w => (
        <div key={`${w.item_type}-${w.item_id}`} className="group cursor-pointer relative"
             onClick={() => navigate(w.item_type === 'show' ? `/media/watch/show/${w.item_id}` : `/media/watch/movie/${w.item_id}`)}>
          <div className="aspect-[2/3] rounded-xl relative overflow-hidden shadow-lg ring-1 ring-white/5 group-hover:ring-blue-400/40 transition-all"
               style={{ background: 'rgba(255,255,255,0.05)' }}>
            {posterUrl(w.poster_path)
              ? <img src={posterUrl(w.poster_path)!} alt={w.title ?? ''} className="w-full h-full object-cover group-hover:scale-[1.07] transition-transform duration-500" loading="lazy" />
              : <div className="w-full h-full flex items-center justify-center"><Bookmark className="w-10 h-10 text-white/30" /></div>}
            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-semibold uppercase tracking-wide">
              {w.item_type === 'show' ? 'Série' : 'Film'}
            </span>
            <button
              onClick={e => { e.stopPropagation(); remove(w.item_type, w.item_id) }}
              title="Retirer de ma liste"
              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 text-white/80 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-sm font-semibold text-text-primary truncate pt-2.5 px-0.5">{w.title}</p>
        </div>
      ))}
    </div>
  )
}

// ── Tab: Shows ───────────────────────────────────────────────────────────────

function ShowsTab() {
  const navigate = useNavigate()
  const search = useMediaSearchStore(s => s.query)

  const { data: shows = [], isLoading } = useQuery({
    queryKey: ['media', 'shows', search],
    queryFn:  () => mediaApi.getShows({ q: search || undefined, limit: 100 }),
  })

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
  }

  if (!isLoading && shows.length === 0 && !search) {
    return (
      <EmptyState
        icon={<Clapperboard className="w-16 h-16" />}
        title="Aucune série"
        subtitle="Créez une bibliothèque « Séries » et lancez un scan pour détecter vos épisodes."
      />
    )
  }

  return (
    <div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {shows.map(show => (
          <ShowCard key={show.id} show={show} onClick={() => navigate(`/media/watch/show/${show.id}`)} />
        ))}
      </div>
    </div>
  )
}

// ── Tab: En cours ─────────────────────────────────────────────────────────────

function ContinueTab() {
  const navigate = useNavigate()

  const { data: movies = [], isLoading } = useQuery({
    queryKey: ['media', 'movies', 'continue'],
    queryFn:  mediaApi.getContinueWatching,
  })

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
  }

  if (movies.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="w-16 h-16" />}
        title="Rien en cours"
        subtitle="Les films que vous avez commencé à regarder apparaîtront ici."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
      {movies.map(m => (
        <ContinueCard key={m.id} movie={m} onClick={() => navigate(`/media/watch/movie/${m.id}`)} />
      ))}
    </div>
  )
}

// ── Main WatchPage ────────────────────────────────────────────────────────────

type Tab = 'home' | 'movies' | 'shows' | 'continue' | 'watchlist'

const TAB_PATHS: Record<string, Tab> = {
  '/media/watch':           'home',
  '/media/watch/movies':    'movies',
  '/media/watch/shows':     'shows',
  '/media/watch/continue':  'continue',
  '/media/watch/watchlist': 'watchlist',
}

export default function WatchPage() {
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const tab: Tab = TAB_PATHS[pathname] ?? 'home'
  const [libPanelOpen, setLibPanelOpen] = useState(false)

  const { data: libraries = [] } = useQuery({
    queryKey: ['media', 'libraries'],
    queryFn:  mediaApi.getLibraries,
  })
  const isScanning = libraries.some(l => l.scan_status === 'scanning')

  const TABS = [
    { id: 'home'      as Tab, label: 'Accueil',  icon: Home,         path: '/media/watch' },
    { id: 'movies'    as Tab, label: 'Films',    icon: Film,         path: '/media/watch/movies' },
    { id: 'shows'     as Tab, label: 'Séries',   icon: Clapperboard, path: '/media/watch/shows' },
    { id: 'continue'  as Tab, label: 'En cours', icon: Clock,        path: '/media/watch/continue' },
    { id: 'watchlist' as Tab, label: 'Ma liste', icon: Bookmark,     path: '/media/watch/watchlist' },
  ]

  return (
    <div className="flex flex-col h-full" style={DARK_PAGE}>
      {/* Dark cinematic hero + pill tabs */}
      <div className="flex-shrink-0 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #1b1730 0%, #241a3a 55%, #181527 100%)' }}>
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(95% 130% at 0% 0%, rgba(47,125,255,0.34) 0%, rgba(47,125,255,0.12) 38%, rgba(0,0,0,0) 72%)' }} />
        <div className="relative px-6 pt-6 pb-6">
          <div className="flex items-end justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                   style={{ background: 'linear-gradient(135deg, #5aa0ff, #1f66e8)' }}>
                <Film className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-white leading-none">Regarder</h1>
                <p className="text-xs text-white/55 mt-1.5">Vos films et séries, en grand</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<Tv size={15} />} onClick={() => navigate('/media/watch/tv')}>
                TV en direct
              </Button>
              <Button size="sm"
                icon={isScanning ? <Loader2 size={15} className="animate-spin" /> : <Library size={15} />}
                onClick={() => setLibPanelOpen(true)}>
                Bibliothèques
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map(t => {
              const active = tab === t.id
              const Icon = t.icon
              return (
                <Button key={t.id} size="sm" variant={active ? 'primary' : 'ghost'}
                  icon={<Icon size={15} />} onClick={() => navigate(t.path)}
                  className={active ? undefined : 'text-white/75 hover:text-white hover:bg-white/10'}>
                  {t.label}
                </Button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {tab === 'home'      && <HomeTab />}
        {tab === 'movies'    && <MoviesTab />}
        {tab === 'shows'     && <ShowsTab />}
        {tab === 'continue'  && <ContinueTab />}
        {tab === 'watchlist' && <WatchlistTab />}
      </div>

      <MediaLibrariesPanel open={libPanelOpen} onClose={() => setLibPanelOpen(false)} />
    </div>
  )
}
