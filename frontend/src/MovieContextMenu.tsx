import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bookmark, Share2, ListEnd, ListPlus, Clapperboard, FolderPlus,
  CheckSquare, RefreshCw, ScanLine, Target, Unlink, Zap,
  Download, UserPlus, History, Info,
} from 'lucide-react'
import { MenuDropdown, type MenuItem } from '@ui'
import { mediaApi, type Movie } from './api'
import { useMediaQueueStore } from './store/mediaQueueStore'
import { useTrailerStore } from './store/trailerStore'
import { useIdentifyStore } from './store/identifyStore'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContextMenuPosition {
  x: number
  y: number
}

interface Props {
  movie:    Movie
  position: ContextMenuPosition
  onClose:  () => void
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MovieContextMenu({ movie, position, onClose }: Props) {
  const navigate     = useNavigate()
  const { t }        = useTranslation('media')
  const queryClient  = useQueryClient()
  const addToQueue    = useMediaQueueStore(s => s.addToQueue)
  const playNextUp    = useMediaQueueStore(s => s.playNextUp)
  const openTrailer   = useTrailerStore(s => s.openTrailer)
  const openIdentify  = useIdentifyStore(s => s.open)

  const [inWatchlist, setInWatchlist] = useState<boolean | null>(null)
  const [isWatched,   setIsWatched]   = useState<boolean | null>(null)
  const [toast,       setToast]       = useState<string | null>(null)

  // Load initial state
  useEffect(() => {
    mediaApi.getWatchlistStatus(movie.id).then(r => setInWatchlist(r.in_watchlist)).catch(() => {})
    mediaApi.getPlayHistory(movie.id).then(r => setIsWatched(r.is_watched ?? false)).catch(() => {})
  }, [movie.id])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function handleWatchlistToggle() {
    try {
      if (inWatchlist) {
        await mediaApi.removeFromWatchlist('movie', movie.id)
        setInWatchlist(false)
        showToast(t('media_toast_removed_watchlist'))
      } else {
        await mediaApi.addToWatchlist('movie', movie.id)
        setInWatchlist(true)
        showToast(t('media_toast_added_watchlist'))
      }
    } catch { showToast(t('media_toast_error')) }
  }

  async function handleMarkWatched() {
    try {
      const res = await mediaApi.markWatched(movie.id)
      setIsWatched(res.is_watched)
      queryClient.invalidateQueries({ queryKey: ['media', 'movies'] })
      showToast(res.is_watched ? t('media_toast_marked_watched') : t('media_toast_marked_unwatched'))
    } catch { showToast(t('media_toast_error')) }
  }

  async function handleRefreshMeta() {
    try {
      await mediaApi.refreshMetadata(movie.id)
      queryClient.invalidateQueries({ queryKey: ['media', 'movie', movie.id] })
      showToast(t('media_toast_meta_refresh_started'))
    } catch { showToast(t('media_toast_error')) }
  }

  async function handleDissociate() {
    try {
      await mediaApi.dissociate(movie.id)
      queryClient.invalidateQueries({ queryKey: ['media', 'movie', movie.id] })
      queryClient.invalidateQueries({ queryKey: ['media', 'movies'] })
      showToast(t('media_toast_meta_dissociated'))
    } catch { showToast(t('media_toast_error')) }
  }

  function handleShare() {
    const url = `${window.location.origin}/media/watch/movie/${movie.id}`
    navigator.clipboard.writeText(url).then(() => showToast(t('media_toast_link_copied'))).catch(() => showToast(t('media_toast_error')))
  }

  function handlePlayNext() {
    playNextUp(movie)
    showToast(t('media_toast_play_next', { title: movie.title }))
  }

  function handleAddToQueue() {
    addToQueue(movie)
    showToast(t('media_toast_added_queue', { title: movie.title }))
  }

  function handleTrailer() {
    const year = movie.release_date ? new Date(movie.release_date).getFullYear() : null
    openTrailer(movie.title, year, movie.trailer_key ?? null)
  }

  function handleViewInfo() {
    navigate(`/media/watch/movie/${movie.id}`)
  }

  function handleViewHistory() {
    navigate(`/media/watch/movie/${movie.id}`)
  }

  const items: MenuItem[] = [
    { type: 'label', text: movie.release_date ? `${movie.title} · ${new Date(movie.release_date).getFullYear()}` : movie.title },
    { type: 'action', icon: <Bookmark className="w-4 h-4" />, label: inWatchlist ? t('media_menu_remove_watchlist') : t('media_menu_add_watchlist'), onClick: handleWatchlistToggle },
    { type: 'action', icon: <Share2 className="w-4 h-4" />,    label: t('media_menu_share'),        onClick: handleShare },
    { type: 'action', icon: <ListEnd className="w-4 h-4" />,   label: t('media_menu_play_next'),    onClick: handlePlayNext },
    { type: 'action', icon: <ListPlus className="w-4 h-4" />,  label: t('media_menu_add_queue'),    onClick: handleAddToQueue },
    { type: 'action', icon: <Clapperboard className="w-4 h-4" />, label: t('media_menu_play_trailer'), onClick: handleTrailer },
    { type: 'action', icon: <FolderPlus className="w-4 h-4" />, label: t('media_menu_add_to'),      onClick: () => showToast(t('media_toast_coming_soon')) },
    { type: 'separator' },
    { type: 'action', icon: <CheckSquare className="w-4 h-4" />, label: isWatched ? t('media_menu_mark_unwatched') : t('media_menu_mark_watched'), onClick: handleMarkWatched },
    { type: 'action', icon: <RefreshCw className="w-4 h-4" />, label: t('media_menu_refresh_meta'), onClick: handleRefreshMeta },
    { type: 'action', icon: <ScanLine  className="w-4 h-4" />, label: t('media_menu_analyze'),      onClick: () => showToast(t('media_toast_analyze_started')) },
    { type: 'action', icon: <Target    className="w-4 h-4" />, label: t('media_menu_fix_match'),    onClick: () => openIdentify({
      kind: 'movie', id: movie.id, name: movie.title,
      year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
    }) },
    { type: 'action', icon: <Unlink    className="w-4 h-4" />, label: t('media_menu_dissociate'),   onClick: handleDissociate },
    { type: 'action', icon: <Zap       className="w-4 h-4" />, label: t('media_menu_optimize'),     onClick: () => showToast(t('media_toast_coming_soon')) },
    { type: 'action', icon: <Download  className="w-4 h-4" />, label: t('media_menu_save_file'),    onClick: () => { window.open(mediaApi.streamUrl(movie.id)) } },
    { type: 'action', icon: <UserPlus  className="w-4 h-4" />, label: t('media_menu_grant_access'), onClick: () => showToast(t('media_toast_coming_soon')) },
    { type: 'separator' },
    { type: 'action', icon: <History className="w-4 h-4" />, label: t('media_menu_view_history'),   onClick: handleViewHistory },
    { type: 'action', icon: <Info    className="w-4 h-4" />, label: t('media_menu_view_info'),      onClick: handleViewInfo },
  ]

  return (
    <>
      <MenuDropdown
        pos={{ top: position.y, left: position.x }}
        onClose={onClose}
        items={items}
      />

      {/* Toast */}
      {toast && (
        <div
          style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10000 }}
          className="bg-surface-0 border border-border rounded-full px-4 py-2 text-sm text-text-primary shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  )
}
