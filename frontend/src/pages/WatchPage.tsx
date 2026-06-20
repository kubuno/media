import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Film, Clapperboard, Clock, Play, Star,
  Loader2, Film as FilmIcon, ChevronRight, Library, Bookmark,
} from 'lucide-react'
import { mediaApi, posterUrl, formatDuration, type Movie, type TvShow } from '../api'
import { useMediaSearchStore } from '../store/mediaSearchStore'
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
        <div className="aspect-[2/3] rounded-xl relative overflow-hidden shadow-lg ring-1 ring-white/5 group-hover:ring-violet-400/40 group-hover:shadow-2xl transition-all duration-300"
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
            style={{ background: '#8b5cf6' }}
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

  const menuItems: MenuItem[] = [
    { type: 'action', icon: <Play className="w-4 h-4" />, label: 'Ouvrir', onClick },
    { type: 'action', icon: <Bookmark className="w-4 h-4" />, label: 'Ajouter à ma liste', onClick: () => { mediaApi.addToWatchlist('show', show.id).catch(() => {}) } },
  ]

  return (
    <>
    <div onClick={onClick} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ top: e.clientY, left: e.clientX }) }}
      className="group cursor-pointer">
      <div className="aspect-[2/3] rounded-xl relative overflow-hidden shadow-lg ring-1 ring-white/5 group-hover:ring-violet-400/40 group-hover:shadow-2xl transition-all duration-300"
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
          style={{ background: '#8b5cf6' }} title="Ouvrir">
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

  const displayMovies = search ? movies : (recent.length > 0 ? recent : movies)

  return (
    <div>
      {!search && recent.length > 0 && (
        <SectionHeader title="Récemment ajoutés" />
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
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
    <div className="flex flex-col h-full" style={DARK_PAGE}>
      {/* Dark cinematic hero (Plex/Kodi-style) + pill tabs */}
      <div className="flex-shrink-0 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #1b1730 0%, #241a3a 55%, #181527 100%)' }}>
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(95% 130% at 0% 0%, rgba(139,92,246,0.34) 0%, rgba(124,58,237,0.12) 38%, rgba(0,0,0,0) 72%)' }} />
        <div className="relative px-6 pt-6 pb-6">
          <div className="flex items-end justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                   style={{ background: 'linear-gradient(135deg, #a78bfa, #7c3aed)' }}>
                <Film className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-white leading-none">Regarder</h1>
                <p className="text-xs text-white/55 mt-1.5">Vos films et séries, en grand</p>
              </div>
            </div>
            <Button size="sm"
              icon={isScanning ? <Loader2 size={15} className="animate-spin" /> : <Library size={15} />}
              onClick={() => setLibPanelOpen(true)}>
              Bibliothèques
            </Button>
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
        {tab === 'movies'   && <MoviesTab />}
        {tab === 'shows'    && <ShowsTab />}
        {tab === 'continue' && <ContinueTab />}
      </div>

      <MediaLibrariesPanel open={libPanelOpen} onClose={() => setLibPanelOpen(false)} />
    </div>
  )
}
