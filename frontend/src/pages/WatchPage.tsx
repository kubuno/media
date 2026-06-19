import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Film, Clapperboard, Clock, Play, Star,
  Loader2, Film as FilmIcon, Search, ChevronRight, Library, Bookmark,
} from 'lucide-react'
import { mediaApi, posterUrl, formatDuration, type Movie, type TvShow } from '../api'
import MediaLibrariesPanel from '../MediaLibrariesPanel'
import { Tabs, Button, MenuDropdown, type MenuDropdownPos, type MenuItem } from '@ui'
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
      <div
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className="group cursor-pointer rounded-xl overflow-hidden bg-surface-1 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5"
      >
        <div className="aspect-[2/3] bg-surface-2 relative overflow-hidden">
          {poster
            ? <img src={poster} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center"><FilmIcon className="w-10 h-10 text-text-tertiary" /></div>
          }
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3 shadow-lg">
              <Play className="w-5 h-5 text-primary fill-primary" />
            </div>
          </div>
          {movie.vote_average && movie.vote_average > 0 && (
            <div className="absolute top-2 right-2 bg-black/70 text-white text-xs rounded-md px-1.5 py-0.5 flex items-center gap-1">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              {movie.vote_average.toFixed(1)}
            </div>
          )}
        </div>
        <div className="p-2.5">
          <p className="text-sm font-medium text-text-primary truncate" title={movie.title}>{movie.title}</p>
          <p className="text-xs text-text-tertiary mt-0.5">{[year, movie.runtime_mins ? `${movie.runtime_mins} min` : null].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      {ctxMenu && (
        <MovieContextMenu
          movie={movie}
          position={ctxMenu}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  )
}

function ShowCard({ show, onClick }: { show: TvShow; onClick: () => void }) {
  const poster = posterUrl(show.poster_path)
  const year   = show.first_air_date ? new Date(show.first_air_date).getFullYear() : null
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  const menuItems: MenuItem[] = [
    { type: 'action', icon: <Play className="w-4 h-4" />, label: 'Ouvrir', onClick },
    { type: 'action', icon: <Bookmark className="w-4 h-4" />, label: 'Ajouter à ma liste', onClick: () => { mediaApi.addToWatchlist('show', show.id).catch(() => {}) } },
  ]

  return (
    <>
    <div
      onClick={onClick}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ top: e.clientY, left: e.clientX }) }}
      className="group cursor-pointer rounded-xl overflow-hidden bg-surface-1 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5"
    >
      <div className="aspect-[2/3] bg-surface-2 relative overflow-hidden">
        {poster
          ? <img src={poster} alt={show.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center"><Clapperboard className="w-10 h-10 text-text-tertiary" /></div>
        }
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3 shadow-lg">
            <Play className="w-5 h-5 text-primary fill-primary" />
          </div>
        </div>
        {show.vote_average && show.vote_average > 0 && (
          <div className="absolute top-2 right-2 bg-black/70 text-white text-xs rounded-md px-1.5 py-0.5 flex items-center gap-1">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            {show.vote_average.toFixed(1)}
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-sm font-medium text-text-primary truncate" title={show.name}>{show.name}</p>
        <p className="text-xs text-text-tertiary mt-0.5">
          {[year, show.season_count > 0 ? `${show.season_count} saison${show.season_count > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
    {ctx && <MenuDropdown pos={ctx} onClose={() => setCtx(null)} items={menuItems} />}
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
  const [search, setSearch] = useState('')

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

  const displayMovies = search ? movies : (recent.length > 0 ? recent : movies)

  return (
    <div>
      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un film…"
          className="w-full pl-9 pr-4 py-2 bg-surface-2 border border-border rounded-full text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
      </div>

      {!search && recent.length > 0 && (
        <SectionHeader title="Récemment ajoutés" />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {displayMovies.map(movie => (
          <MovieCard key={movie.id} movie={movie} onClick={() => navigate(`/media/watch/movie/${movie.id}`)} />
        ))}
      </div>
    </div>
  )
}

// ── Tab: Séries ───────────────────────────────────────────────────────────────

function ShowsTab() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

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
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher une série…"
          className="w-full pl-9 pr-4 py-2 bg-surface-2 border border-border rounded-full text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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

type Tab = 'movies' | 'shows' | 'continue'

const TAB_PATHS: Record<string, Tab> = {
  '/media/watch':          'movies',
  '/media/watch/shows':    'shows',
  '/media/watch/continue': 'continue',
}

export default function WatchPage() {
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const tab: Tab = TAB_PATHS[pathname] ?? 'movies'
  const [libPanelOpen, setLibPanelOpen] = useState(false)

  const { data: libraries = [] } = useQuery({
    queryKey: ['media', 'libraries'],
    queryFn:  mediaApi.getLibraries,
  })
  const isScanning = libraries.some(l => l.scan_status === 'scanning')

  const TABS = [
    { id: 'movies'   as Tab, label: 'Films',    icon: Film,         path: '/media/watch' },
    { id: 'shows'    as Tab, label: 'Séries',   icon: Clapperboard, path: '/media/watch/shows' },
    { id: 'continue' as Tab, label: 'En cours', icon: Clock,        path: '/media/watch/continue' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-text-primary">Regarder</h1>
          <Button
            variant="secondary"
            size="sm"
            icon={isScanning
              ? <Loader2 size={15} className="animate-spin text-primary" />
              : <Library size={15} />
            }
            onClick={() => setLibPanelOpen(true)}
          >
            Bibliothèques
          </Button>
        </div>

        {/* Tabs */}
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={id => navigate(TABS.find(t => t.id === id)!.path)}
          className="-mb-px"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {tab === 'movies'   && <MoviesTab />}
        {tab === 'shows'    && <ShowsTab />}
        {tab === 'continue' && <ContinueTab />}
      </div>

      <MediaLibrariesPanel open={libPanelOpen} onClose={() => setLibPanelOpen(false)} />
    </div>
  )
}
