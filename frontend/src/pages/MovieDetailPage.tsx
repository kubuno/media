import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Star, Clock, Film as FilmIcon,
  Calendar, Globe, Loader2, Monitor, Shield, HardDrive,
  ChevronLeft, ChevronRight, Check, Clapperboard,
} from 'lucide-react'
import { mediaApi, posterUrl, type Movie, type CastMember } from '../api'
import { useMediaVideoStore } from '../store/mediaVideoStore'
import { useTrailerStore } from '../store/trailerStore'
import { Button } from '@ui'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRes(w: number | null, h: number | null): string | null {
  if (!w || !h) return null
  if (h >= 2160) return '4K'
  if (h >= 1080) return '1080p'
  if (h >= 720)  return '720p'
  return `${w}×${h}`
}

function formatRuntime(mins: number | null, secs: number): string {
  const m = mins ?? Math.round(secs / 60)
  const h = Math.floor(m / 60)
  const rest = m % 60
  return h > 0 ? `${h}h${rest > 0 ? ` ${rest}min` : ''}` : `${rest}min`
}

// ── Cast card ─────────────────────────────────────────────────────────────────

function CastCard({ member }: { member: CastMember }) {
  const src = member.profile_path
    ? (member.profile_path.startsWith('http') ? member.profile_path : posterUrl(member.profile_path, 'w185'))
    : null

  return (
    <div className="flex-shrink-0 w-24 text-center">
      <div className="w-24 h-24 rounded-full overflow-hidden bg-surface-2 mx-auto mb-2 flex items-center justify-center">
        {src
          ? <img src={src} alt={member.name} className="w-full h-full object-cover" loading="lazy" />
          : <span className="text-2xl text-text-tertiary font-bold">{member.name.charAt(0)}</span>
        }
      </div>
      <p className="text-xs font-medium text-text-primary leading-tight truncate">{member.name}</p>
      {member.character && (
        <p className="text-xs text-text-tertiary leading-tight truncate">{member.character}</p>
      )}
    </div>
  )
}

// ── Poster selector modal ─────────────────────────────────────────────────────

function PosterSelectorModal({
  movieId,
  currentPoster,
  posterUrls,
  onClose,
  onChanged,
}: {
  movieId:      string
  currentPoster: string | null
  posterUrls:   string[]
  onClose:      () => void
  onChanged:    (url: string) => void
}) {
  const [saving, setSaving] = useState<string | null>(null)

  async function handleSelect(url: string) {
    if (url === currentPoster) { onClose(); return }
    setSaving(url)
    try {
      await mediaApi.setPoster(movieId, url)
      onChanged(url)
      onClose()
    } catch {
      setSaving(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-0 rounded-2xl shadow-2xl p-5 w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text-primary">Choisir une affiche</h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1 rounded-lg hover:bg-surface-2 transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto flex-1">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {posterUrls.map((url, i) => {
              const isCurrent = url === currentPoster
              const isSaving  = saving === url
              return (
                <button
                  key={i}
                  onClick={() => handleSelect(url)}
                  disabled={isSaving}
                  className={`relative aspect-[2/3] rounded-xl overflow-hidden border-2 transition-all ${
                    isCurrent ? 'border-primary' : 'border-transparent hover:border-primary/50'
                  }`}
                >
                  <img
                    src={url}
                    alt={`Affiche ${i + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {isCurrent && (
                    <div className="absolute top-2 right-2 bg-primary rounded-full p-1">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                  {isSaving && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="w-6 h-6 text-white animate-spin" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Content rating badge ──────────────────────────────────────────────────────

function RatingBadge({ rating }: { rating: string }) {
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/40 text-white/90 text-xs font-mono font-semibold">
      <Shield className="w-3 h-3" />
      {rating}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MovieDetailPage() {
  const { id }         = useParams<{ id: string }>()
  const navigate       = useNavigate()
  const queryClient    = useQueryClient()
  const openPlayer     = useMediaVideoStore(s => s.open)
  const openTrailer    = useTrailerStore(s => s.openTrailer)
  const [imgError, setImgError]           = useState(false)
  const [posterModal, setPosterModal]     = useState(false)

  const { data: movie, isLoading, isError } = useQuery<Movie>({
    queryKey: ['media', 'movie', id],
    queryFn:  () => mediaApi.getMovie(id!),
    enabled:  !!id,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  if (isError || !movie) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary">
        <FilmIcon className="w-16 h-16 text-text-tertiary" />
        <p>Film introuvable.</p>
        <button onClick={() => navigate('/media/watch')} className="text-primary hover:underline text-sm">
          Retour à la bibliothèque
        </button>
      </div>
    )
  }

  const year       = movie.release_date ? new Date(movie.release_date).getFullYear() : null
  const poster     = posterUrl(movie.poster_path)
  const backdrop   = posterUrl(movie.backdrop_path, 'w500') ?? poster
  const runtime    = formatRuntime(movie.runtime_mins, movie.duration_secs)
  const resolution = formatRes(movie.resolution_w, movie.resolution_h)

  // Crew by role
  const directors = (movie.crew ?? []).filter(c =>
    c.job === 'Director' || c.job === 'Réalisateur'
  )
  const writers = (movie.crew ?? []).filter(c =>
    c.job === 'Screenplay' || c.job === 'Writer' || c.job === 'Scénariste'
  )
  const producers = (movie.crew ?? []).filter(c =>
    c.job === 'Producer' || c.job === 'Producteur'
  )
  const cast = movie.cast?.slice(0, 12) ?? []

  // Multiple posters: combine poster_urls and current poster_path
  const allPosters = Array.from(new Set([
    ...(movie.poster_urls ?? []),
    ...(movie.poster_path ? [movie.poster_path] : []),
  ]))

  function handlePlay() {
    openPlayer(movie!.id, movie!.title)
  }

  function handleTrailer() {
    openTrailer(movie!.title, year, movie!.trailer_key ?? null)
  }

  function handlePosterChanged(url: string) {
    queryClient.setQueryData<Movie>(['media', 'movie', id], old =>
      old ? { ...old, poster_path: url } : old
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-0">
      {/* Back button */}
      <div className="px-6 pt-5 pb-0 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
      </div>

      {/* Hero */}
      <div className="relative flex-shrink-0 mx-6 mt-4 rounded-2xl overflow-hidden bg-surface-2" style={{ minHeight: 220 }}>
        {backdrop && !imgError && (
          <img
            src={backdrop}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        <div className="relative flex items-end gap-6 p-6 min-h-[220px]">
          {/* Poster with optional change button */}
          {poster && (
            <div className="hidden sm:flex flex-col items-center gap-2 flex-shrink-0">
              <div className="w-28 h-40 rounded-xl overflow-hidden shadow-2xl">
                <img src={poster} alt={movie.title} className="w-full h-full object-cover" />
              </div>
              {allPosters.length > 1 && (
                <button
                  onClick={() => setPosterModal(true)}
                  className="flex items-center gap-1 text-xs text-white/70 hover:text-white transition-colors bg-black/30 rounded-full px-2 py-0.5"
                >
                  <ChevronLeft className="w-3 h-3" />
                  <ChevronRight className="w-3 h-3" />
                  Changer
                </button>
              )}
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            {movie.tagline && (
              <p className="text-white/70 text-sm italic mb-1">{movie.tagline}</p>
            )}
            <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-1">
              {movie.title}
            </h1>
            {movie.original_title && movie.original_title !== movie.title && (
              <p className="text-white/60 text-sm mb-2">{movie.original_title}</p>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80 mb-3">
              {year && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {year}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {runtime}
              </span>
              {movie.vote_average && movie.vote_average > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                  {movie.vote_average.toFixed(1)}
                </span>
              )}
              {resolution && (
                <span className="flex items-center gap-1">
                  <Monitor className="w-3.5 h-3.5" />
                  {resolution}
                </span>
              )}
              {movie.content_rating && (
                <RatingBadge rating={movie.content_rating} />
              )}
            </div>

            {/* Genres */}
            {movie.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {movie.genres.map(g => (
                  <span key={g} className="px-2.5 py-0.5 rounded-full bg-white/10 text-white/90 text-xs border border-white/20">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <Button icon={<Play className="w-4 h-4 fill-white" />} onClick={handlePlay} className="px-6">
                Lire le film
              </Button>
              <button
                onClick={handleTrailer}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full font-medium text-sm border border-white/20 transition-colors"
              >
                <Clapperboard className="w-4 h-4" />
                Bande annonce
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="px-6 py-6 space-y-6 flex-1">
        {/* Synopsis */}
        {movie.overview && (
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-2">Synopsis</h2>
            <p className="text-text-primary text-sm leading-relaxed">{movie.overview}</p>
          </section>
        )}

        {/* Crew sections */}
        {directors.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-1">
              {directors.length > 1 ? 'Réalisateurs' : 'Réalisation'}
            </h2>
            <p className="text-text-primary text-sm">{directors.map(d => d.name).join(', ')}</p>
          </section>
        )}

        {writers.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-1">
              {writers.length > 1 ? 'Scénaristes' : 'Scénario'}
            </h2>
            <p className="text-text-primary text-sm">{writers.map(w => w.name).join(', ')}</p>
          </section>
        )}

        {producers.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-1">
              {producers.length > 1 ? 'Producteurs' : 'Production'}
            </h2>
            <p className="text-text-primary text-sm">{producers.map(p => p.name).join(', ')}</p>
          </section>
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">Distribution</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
              {cast.map((m, i) => <CastCard key={i} member={m} />)}
            </div>
          </section>
        )}

        {/* Tech info */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-2">Informations techniques</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {resolution && <InfoChip label="Résolution" value={resolution} />}
            {movie.video_codec && <InfoChip label="Vidéo" value={movie.video_codec.toUpperCase()} />}
            {movie.audio_codec && <InfoChip label="Audio" value={movie.audio_codec.toUpperCase()} />}
            {movie.original_language && (
              <InfoChip label="Langue originale" value={movie.original_language.toUpperCase()} icon={<Globe className="w-3.5 h-3.5" />} />
            )}
          </div>
          {movie.file_path && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-surface-1 border border-border">
              <HardDrive className="w-4 h-4 text-text-tertiary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-text-tertiary mb-0.5">Emplacement du fichier</p>
                <p className="text-xs font-mono text-text-secondary break-all">{movie.file_path}</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Poster selector modal */}
      {posterModal && allPosters.length > 1 && (
        <PosterSelectorModal
          movieId={movie.id}
          currentPoster={movie.poster_path}
          posterUrls={allPosters}
          onClose={() => setPosterModal(false)}
          onChanged={handlePosterChanged}
        />
      )}
    </div>
  )
}

function InfoChip({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-surface-1 border border-border">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-sm font-medium text-text-primary flex items-center gap-1">
        {icon}{value}
      </span>
    </div>
  )
}
