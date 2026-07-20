import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  Search, Loader2, Film, Tv, Mic2, Disc3, Star, Check, X,
} from 'lucide-react'
import { Button } from '@ui'
import {
  mediaApi,
  type MovieCandidate, type ShowCandidate, type ArtistCandidate, type AlbumCandidate,
} from './api'
import { useIdentifyStore, type IdentifyTarget } from './store/identifyStore'

// One dialog, four kinds of candidates. The union keeps a single result list.
type AnyCandidate =
  | { kind: 'movie';  c: MovieCandidate }
  | { kind: 'show';   c: ShowCandidate }
  | { kind: 'artist'; c: ArtistCandidate }
  | { kind: 'album';  c: AlbumCandidate }

const KIND_ICON = { movie: Film, show: Tv, artist: Mic2, album: Disc3 } as const

function candidateKey(item: AnyCandidate): string {
  switch (item.kind) {
    case 'movie':  return `m${item.c.tmdb_id ?? `${item.c.title}-${item.c.year ?? ''}`}`
    case 'show':   return `s${item.c.tvmaze_id}`
    case 'artist': return `a${item.c.mbid}`
    case 'album':  return `b${item.c.mbid}`
  }
}

// ── Candidate card ────────────────────────────────────────────────────────────

function CandidateCard({
  item, applying, onApply,
}: {
  item:     AnyCandidate
  applying: boolean
  onApply:  () => void
}) {
  const { t } = useTranslation('media')

  let poster: string | null = null
  let title = ''
  let subtitle: string | null = null
  let overview: string | null = null
  let vote: number | null = null

  switch (item.kind) {
    case 'movie':
      poster   = item.c.poster_url
      title    = item.c.title
      subtitle = [item.c.year, item.c.original_title !== item.c.title ? item.c.original_title : null,
        item.c.source === 'wikipedia' ? 'Wikipédia' : null]
        .filter(Boolean).join(' · ') || null
      overview = item.c.overview
      vote     = item.c.vote_average
      break
    case 'show':
      poster   = item.c.poster_url
      title    = item.c.name
      subtitle = [item.c.year, item.c.network, item.c.status].filter(Boolean).join(' · ') || null
      overview = item.c.overview
      break
    case 'artist':
      title    = item.c.name
      subtitle = [item.c.type, item.c.country, item.c.begin?.slice(0, 4), item.c.disambiguation]
        .filter(Boolean).join(' · ') || null
      break
    case 'album':
      title    = item.c.title
      subtitle = [item.c.artist, item.c.year, item.c.type].filter(Boolean).join(' · ') || null
      break
  }

  const Icon = KIND_ICON[item.kind]

  return (
    <div className="flex gap-3 p-3 rounded-xl border border-border bg-surface-1 hover:border-primary/50 transition-colors">
      <div className="w-14 h-20 rounded-lg overflow-hidden bg-surface-2 flex-shrink-0 flex items-center justify-center">
        {poster
          ? <img src={poster} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <Icon className="w-6 h-6 text-text-tertiary" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-text-primary truncate">{title}</p>
          {vote != null && vote > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-text-secondary flex-shrink-0">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              {vote.toFixed(1)}
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-text-tertiary truncate mt-0.5">{subtitle}</p>}
        {overview && <p className="text-xs text-text-secondary mt-1 line-clamp-2">{overview}</p>}
      </div>
      <div className="flex items-center flex-shrink-0">
        <Button size="sm" disabled={applying}
          icon={applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          onClick={onApply}>
          {t('media_identify_use')}
        </Button>
      </div>
    </div>
  )
}

// ── Dialog ────────────────────────────────────────────────────────────────────

function IdentifyDialogInner({ target }: { target: IdentifyTarget }) {
  const { t }       = useTranslation('media')
  const close       = useIdentifyStore(s => s.close)
  const queryClient = useQueryClient()

  const [query, setQuery]         = useState(target.name)
  const [year, setYear]           = useState<string>(target.year ? String(target.year) : '')
  const [searching, setSearching] = useState(false)
  const [applying, setApplying]   = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [results, setResults]     = useState<AnyCandidate[] | null>(null)

  const runSearch = useCallback(async (q: string, y: string) => {
    setSearching(true)
    setError(null)
    try {
      let items: AnyCandidate[] = []
      switch (target.kind) {
        case 'movie': {
          const r = await mediaApi.identifyMovie(target.id, q, y ? parseInt(y, 10) : null)
          items = r.candidates.map(c => ({ kind: 'movie', c }))
          break
        }
        case 'show': {
          const r = await mediaApi.identifyShow(target.id, q)
          items = r.candidates.map(c => ({ kind: 'show', c }))
          break
        }
        case 'artist': {
          const r = await mediaApi.identifyArtist(target.id, q)
          items = r.candidates.map(c => ({ kind: 'artist', c }))
          break
        }
        case 'album': {
          const r = await mediaApi.identifyAlbum(target.id, q, target.artist ?? undefined)
          items = r.candidates.map(c => ({ kind: 'album', c }))
          break
        }
      }
      setResults(items)
    } catch {
      setError(t('media_identify_search_error'))
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [target, t])

  // Search immediately with the current name on open.
  useEffect(() => {
    void runSearch(target.name, target.year ? String(target.year) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id])

  async function handleApply(item: AnyCandidate) {
    setApplying(candidateKey(item))
    setError(null)
    try {
      switch (item.kind) {
        case 'movie':  await mediaApi.applyMovieMatch(target.id, item.c);        break
        case 'show':   await mediaApi.applyShowMatch(target.id, item.c.tvmaze_id); break
        case 'artist': await mediaApi.applyArtistMatch(target.id, item.c.mbid);  break
        case 'album':  await mediaApi.applyAlbumMatch(target.id, item.c.mbid);   break
      }
      // Refresh every view of the item.
      queryClient.invalidateQueries({ queryKey: ['media'] })
      close()
    } catch {
      setError(t('media_identify_apply_error'))
      setApplying(null)
    }
  }

  const Icon = KIND_ICON[target.kind]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={() => { if (!applying) close() }}
    >
      <div
        className="bg-surface-0 rounded-2xl shadow-2xl p-5 w-full max-w-xl max-h-[80vh] flex flex-col mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text-primary flex items-center gap-2">
            <Icon className="w-4 h-4 text-primary" />
            {t('media_identify_title')} — {target.name}
          </h3>
          <button
            onClick={close}
            disabled={!!applying}
            className="text-text-tertiary hover:text-text-primary p-1 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search row */}
        <form
          className="flex gap-2 mb-4"
          onSubmit={e => { e.preventDefault(); void runSearch(query, year) }}
        >
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('media_identify_search_placeholder')}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          </div>
          {target.kind === 'movie' && (
            <input
              value={year}
              onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder={t('media_identify_year')}
              className="w-20 px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          )}
          <Button type="submit" disabled={searching || !query.trim()}
            icon={searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}>
            {t('media_identify_search')}
          </Button>
        </form>

        {error && (
          <p className="text-sm text-danger mb-3">{error}</p>
        )}

        {/* Results */}
        <div className="overflow-y-auto flex-1 space-y-2 min-h-[120px]">
          {searching && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          )}
          {!searching && results !== null && results.length === 0 && !error && (
            <p className="text-sm text-text-tertiary text-center py-10">{t('media_identify_no_results')}</p>
          )}
          {!searching && results?.map(item => (
            <CandidateCard
              key={candidateKey(item)}
              item={item}
              applying={applying === candidateKey(item)}
              onApply={() => void handleApply(item)}
            />
          ))}
        </div>

        <p className="text-xs text-text-tertiary mt-3">
          {target.kind === 'movie' ? t('media_identify_hint_tmdb')
            : target.kind === 'show' ? t('media_identify_hint_tvmaze')
            : t('media_identify_hint_musicbrainz')}
        </p>
      </div>
    </div>
  )
}

/** App-wide host: renders the dialog when a target is set (SlotRegistry `app-dialogs`). */
export default function IdentifyDialog() {
  const target = useIdentifyStore(s => s.target)
  if (!target) return null
  return <IdentifyDialogInner target={target} />
}
