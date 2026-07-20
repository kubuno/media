import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mic2, Disc3, ListMusic, Heart, Play,
  Loader2, Music, Clock, Library, Sliders,
  Plus, Pencil, Trash2, Globe, Lock, ListPlus, ListEnd, HeartOff, User, Shuffle, ArrowUpDown,
  MoreHorizontal, RefreshCw, Target, Unlock,
} from 'lucide-react'
import { mediaApi, posterUrl, formatDuration, type Artist, type Album, type Track, type Playlist } from '../api'
import { Checkbox, Button, MenuDropdown, Input, useMenuDropdown, type MenuDropdownPos, type MenuItem } from '@ui'
import MediaLibrariesPanel from '../MediaLibrariesPanel'
import { usePlayerStore, type PlayerTrack } from '../store/playerStore'
import { useMediaSearchStore } from '../store/mediaSearchStore'
import { useIdentifyStore } from '../store/identifyStore'
import { DARK_PAGE } from '../darkTheme'
import { QUEUE_DRAG_TYPE } from '../components/listen/player/QueuePanel'

function trackToPlayerTrack(t: Track): PlayerTrack {
  return {
    id: t.id,
    title: t.title,
    durationSecs: t.duration_secs,
    coverUrl: posterUrl(t.cover_path ?? null) ?? undefined,
    artistName: t.artist_name ?? undefined,
  }
}

/** Enable shuffle mode and play a randomised copy of the queue from the top. */
function playShuffled(queue: PlayerTrack[]) {
  if (queue.length === 0) return
  const shuffled = [...queue].sort(() => Math.random() - 0.5)
  const store = usePlayerStore.getState()
  if (!store.shuffle) store.toggleShuffle()
  store.playTrack(shuffled[0], shuffled, 0)
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-text-tertiary mb-4">{icon}</div>
      <p className="text-text-primary font-medium">{title}</p>
      <p className="text-text-secondary text-sm mt-1 max-w-xs">{subtitle}</p>
    </div>
  )
}

// ── Artist card ───────────────────────────────────────────────────────────────

function ArtistCard({ artist, onClick }: { artist: Artist; onClick: () => void }) {
  const img = artist.image_path
  const { playTrack } = usePlayerStore()
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  const playArtist = async () => {
    const data = await mediaApi.getArtist(artist.id)
    const q: PlayerTrack[] = data.top_tracks.map(t => ({ id: t.id, title: t.title, artistName: data.name, durationSecs: t.duration_secs }))
    if (q.length) playTrack(q[0], q, 0)
  }

  const menuItems: MenuItem[] = [
    { type: 'action', icon: <Play className="w-4 h-4" />, label: 'Lire', onClick: () => { void playArtist() } },
    { type: 'action', icon: <Mic2 className="w-4 h-4" />, label: "Ouvrir l'artiste", onClick },
  ]

  return (
    <>
    <div onClick={onClick} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ top: e.clientY, left: e.clientX }) }}
         className="group cursor-pointer text-center rounded-2xl p-3 transition-all duration-300 hover:bg-white/5">
      <div className="aspect-square rounded-full overflow-hidden mb-3 relative mx-auto w-full ring-1 ring-white/10 group-hover:ring-2 group-hover:ring-blue-400/50 shadow-lg transition-all duration-300 bg-white/5">
        {img
          ? <img src={img} alt={artist.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center"><Mic2 className="w-10 h-10 text-white/40" /></div>
        }
        <button
          onClick={e => { e.stopPropagation(); void playArtist() }}
          className="absolute bottom-3 right-3 w-11 h-11 rounded-full flex items-center justify-center text-white shadow-lg translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 hover:scale-110"
          style={{ background: '#2f7dff' }}
          title="Lire">
          <Play className="w-5 h-5 fill-white ml-0.5" />
        </button>
      </div>
      <p className="text-sm font-semibold text-text-primary truncate" title={artist.name}>{artist.name}</p>
      <p className="text-xs text-text-tertiary mt-0.5">
        {[artist.album_count > 0 ? `${artist.album_count} album${artist.album_count > 1 ? 's' : ''}` : 'Artiste'].filter(Boolean).join(' · ')}
      </p>
    </div>
    {ctx && <MenuDropdown theme="dark" pos={ctx} onClose={() => setCtx(null)} items={menuItems} />}
    </>
  )
}

// ── Album card ────────────────────────────────────────────────────────────────

function AlbumCard({ album, onClick }: { album: Album; onClick: () => void }) {
  const cover = album.cover_path ? posterUrl(album.cover_path) : null
  const navigate = useNavigate()
  const { playTrack, addTracksToQueue } = usePlayerStore()
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  const albumQueue = async (): Promise<PlayerTrack[]> => {
    const { album: al, tracks } = await mediaApi.getAlbum(album.id)
    const cv = al.cover_path ? posterUrl(al.cover_path) : null
    return tracks.map(t => ({ id: t.id, title: t.title, albumTitle: al.title, coverUrl: cv ?? undefined, durationSecs: t.duration_secs }))
  }
  const playAlbum = async () => { const q = await albumQueue(); if (q.length) playTrack(q[0], q, 0) }
  const queueAlbum = async () => { const q = await albumQueue(); if (q.length) addTracksToQueue(q) }

  const menuItems: MenuItem[] = [
    { type: 'action', icon: <Play className="w-4 h-4" />, label: "Lire l'album", onClick: () => { void playAlbum() } },
    { type: 'action', icon: <ListPlus className="w-4 h-4" />, label: 'Ajouter à la file', onClick: () => { void queueAlbum() } },
    { type: 'separator' },
    { type: 'action', icon: <Disc3 className="w-4 h-4" />, label: "Ouvrir l'album", onClick: onClick },
    ...(album.artist_id ? [{ type: 'action' as const, icon: <User className="w-4 h-4" />, label: "Aller à l'artiste", onClick: () => navigate(`/media/listen/artist/${album.artist_id}`) }] : []),
  ]

  return (
    <>
    <div onClick={onClick} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ top: e.clientY, left: e.clientX }) }}
         className="group cursor-pointer rounded-2xl p-3 bg-transparent hover:bg-white/[0.06] transition-all duration-300 hover:-translate-y-1">
      <div className="aspect-square rounded-xl relative overflow-hidden shadow-lg bg-white/5">
        {cover
          ? <img src={cover} alt={album.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center"><Disc3 className="w-12 h-12 text-white/40" /></div>
        }
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <button
          onClick={e => { e.stopPropagation(); void playAlbum() }}
          className="absolute bottom-3 right-3 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 hover:scale-110"
          style={{ background: '#2f7dff' }}
          title="Lire l'album">
          <Play className="w-5 h-5 fill-white ml-0.5" />
        </button>
      </div>
      <div className="pt-3 px-0.5">
        <p className="text-sm font-semibold text-text-primary truncate" title={album.title}>{album.title}</p>
        <p className="text-xs text-text-tertiary mt-0.5 truncate">
          {[album.release_year, album.track_count > 0 ? `${album.track_count} titres` : null].filter(Boolean).join(' · ') || 'Album'}
        </p>
      </div>
    </div>
    {ctx && <MenuDropdown theme="dark" pos={ctx} onClose={() => setCtx(null)} items={menuItems} />}
    </>
  )
}

// ── Track row ─────────────────────────────────────────────────────────────────

function TrackRow({ track, index, onPlay, onToggleLike, liked, onAddToQueue, playerTrack }: {
  track: Track
  index?: number
  onPlay: () => void
  onToggleLike: () => void
  liked: boolean
  onAddToQueue?: () => void
  playerTrack?: PlayerTrack
}) {
  const navigate   = useNavigate()
  const insertNext = usePlayerStore(s => s.insertNext)
  const addToQueue = usePlayerStore(s => s.addToQueue)
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  // Playlists fetched lazily, only when a context menu is open.
  const { data: playlists = [] } = useQuery({
    queryKey: ['media', 'playlists'],
    queryFn:  mediaApi.getPlaylists,
    enabled:  ctx !== null,
  })

  const handleDragStart = (e: React.DragEvent) => {
    if (!playerTrack) return
    e.dataTransfer.setData(QUEUE_DRAG_TYPE, JSON.stringify(playerTrack))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const addToPlaylist: MenuItem = playlists.length > 0
    ? {
        type: 'submenu', label: 'Ajouter à une playlist', icon: <ListPlus className="w-4 h-4" />,
        items: playlists.map(p => ({
          type: 'action' as const, label: p.name,
          onClick: () => { mediaApi.addTracksToPlaylist(p.id, [track.id]).catch(() => {}) },
        })),
      }
    : { type: 'action', label: 'Ajouter à une playlist', icon: <ListPlus className="w-4 h-4" />, disabled: true, onClick: () => {} }

  const menuItems: MenuItem[] = [
    { type: 'action', icon: <Play className="w-4 h-4" />, label: 'Lire', onClick: onPlay },
    ...(playerTrack ? [
      { type: 'action' as const, icon: <ListEnd className="w-4 h-4" />, label: 'Lire ensuite', onClick: () => insertNext(playerTrack) },
      { type: 'action' as const, icon: <ListPlus className="w-4 h-4" />, label: 'Ajouter à la file', onClick: () => (onAddToQueue ? onAddToQueue() : addToQueue(playerTrack)) },
    ] : []),
    addToPlaylist,
    { type: 'separator' },
    { type: 'action', icon: liked ? <HeartOff className="w-4 h-4" /> : <Heart className="w-4 h-4" />, label: liked ? 'Retirer des favoris' : 'Ajouter aux favoris', onClick: onToggleLike },
    ...(track.album_id ? [{ type: 'action' as const, icon: <Disc3 className="w-4 h-4" />, label: "Aller à l'album", onClick: () => navigate(`/media/listen/album/${track.album_id}`) }] : []),
    ...(track.artist_id ? [{ type: 'action' as const, icon: <User className="w-4 h-4" />, label: "Aller à l'artiste", onClick: () => navigate(`/media/listen/artist/${track.artist_id}`) }] : []),
  ]

  return (
    <>
    <div
      className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors cursor-pointer"
      onClick={onPlay}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ top: e.clientY, left: e.clientX }) }}
      draggable={!!playerTrack}
      onDragStart={playerTrack ? handleDragStart : undefined}
    >
      <div className="w-8 text-center flex-shrink-0">
        <span className="text-sm text-text-tertiary group-hover:hidden">{index ?? '·'}</span>
        <Play className="w-4 h-4 text-primary fill-primary hidden group-hover:block mx-auto" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{track.title}</p>
      </div>
      {onAddToQueue && (
        <button
          onClick={e => { e.stopPropagation(); onAddToQueue() }}
          title="Ajouter à la file de lecture"
          className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-all text-text-tertiary hover:text-primary hover:bg-primary/10"
        >
          <ListPlus className="w-4 h-4" />
        </button>
      )}
      <button
        onClick={e => { e.stopPropagation(); onToggleLike() }}
        className={`flex-shrink-0 p-1 rounded transition-colors ${liked ? 'text-red-500' : 'text-text-tertiary hover:text-text-secondary'}`}
      >
        <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
      </button>
      <span className="text-xs text-text-tertiary flex-shrink-0 w-10 text-right">
        {formatDuration(track.duration_secs)}
      </span>
    </div>
    {ctx && <MenuDropdown theme="dark" pos={ctx} onClose={() => setCtx(null)} items={menuItems} />}
    </>
  )
}

// ── Playlist dialog (create / rename) ─────────────────────────────────────────

function PlaylistDialog({ mode, initial, onSave, onClose }: {
  mode:     'create' | 'edit'
  initial?: { name: string; description?: string | null; is_public?: boolean }
  onSave:   (d: { name: string; description: string; is_public: boolean }) => void
  onClose:  () => void
}) {
  const [name,     setName]     = useState(initial?.name ?? '')
  const [desc,     setDesc]     = useState(initial?.description ?? '')
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
         onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4"
           onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-text-primary mb-4">
          {mode === 'create' ? 'Nouvelle playlist' : 'Renommer la playlist'}
        </h2>
        <div className="space-y-3">
          <Input
            autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave({ name: name.trim(), description: desc ?? '', is_public: isPublic }) }}
            placeholder="Nom de la playlist"
          />
          {mode === 'create' && (
            <>
              <Input
                type="text" value={desc ?? ''} onChange={e => setDesc(e.target.value)}
                placeholder="Description (optionnel)"
              />
              <Checkbox
                label="Playlist publique"
                checked={isPublic}
                onChange={v => setIsPublic(v)}
              />
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            onClick={() => { if (name.trim()) onSave({ name: name.trim(), description: desc ?? '', is_public: isPublic }) }}
            disabled={!name.trim()}
          >
            {mode === 'create' ? 'Créer' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Playlist card ─────────────────────────────────────────────────────────────

function PlaylistCard({
  playlist, onClick, onRename, onDelete, onTogglePublic,
}: {
  playlist:       Playlist
  onClick:        () => void
  onRename:       () => void
  onDelete:       () => void
  onTogglePublic: () => void
}) {
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={e => { e.preventDefault(); setCtx({ top: e.clientY, left: e.clientX }) }}
        className="group cursor-pointer flex items-center gap-3 p-3 rounded-xl hover:bg-surface-2 transition-colors"
      >
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
          <ListMusic className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-text-primary truncate">{playlist.name}</p>
            {playlist.is_public
              ? <Globe className="w-3 h-3 text-text-tertiary flex-shrink-0" />
              : <Lock  className="w-3 h-3 text-text-tertiary flex-shrink-0" />
            }
          </div>
          <p className="text-xs text-text-tertiary mt-0.5">
            {[playlist.track_count > 0 ? `${playlist.track_count} titre${playlist.track_count > 1 ? 's' : ''}` : 'Vide',
              formatDuration(playlist.duration_secs) || null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Play className="w-4 h-4 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {ctx && (
        <MenuDropdown
          theme="dark"
          pos={ctx}
          onClose={() => setCtx(null)}
          items={[
            { type: 'action', icon: <Pencil className="w-4 h-4" />, label: 'Renommer', onClick: onRename },
            {
              type: 'action',
              icon: playlist.is_public ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />,
              label: playlist.is_public ? 'Rendre privée' : 'Rendre publique',
              onClick: onTogglePublic,
            },
            { type: 'separator' },
            { type: 'action', icon: <Trash2 className="w-4 h-4" />, label: 'Supprimer', danger: true, onClick: onDelete },
          ]}
        />
      )}
    </>
  )
}

// ── Tab: Artistes ─────────────────────────────────────────────────────────────

function ArtistsTab() {
  const navigate = useNavigate()
  const search = useMediaSearchStore(s => s.query)
  const [sort, setSort] = useState<'name' | 'albums'>('name')

  const { data: artistsRaw = [], isLoading } = useQuery({
    queryKey: ['media', 'artists', search],
    queryFn:  () => mediaApi.getArtists({ q: search || undefined, limit: 100 }),
  })
  const artists = [...artistsRaw].sort((a, b) =>
    sort === 'albums' ? (b.album_count ?? 0) - (a.album_count ?? 0) : a.name.localeCompare(b.name))

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>

  if (!isLoading && artists.length === 0 && !search) {
    return (
      <EmptyState
        icon={<Music className="w-16 h-16" />}
        title="Aucun artiste"
        subtitle="Créez une bibliothèque « Musique » et lancez un scan pour détecter vos fichiers audio."
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-6">
        <SortSelect value={sort} onChange={v => setSort(v as typeof sort)} options={[['name', 'Nom A→Z'], ['albums', "Nb d'albums"]]} />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {artists.map(a => (
          <ArtistCard key={a.id} artist={a} onClick={() => navigate(`/media/listen/artist/${a.id}`)} />
        ))}
      </div>
    </div>
  )
}

// ── Tab: Albums ───────────────────────────────────────────────────────────────

function AlbumsTab() {
  const navigate = useNavigate()
  const search = useMediaSearchStore(s => s.query)
  const [sort, setSort] = useState<'title' | 'year' | 'tracks'>('title')

  const { data: albumsRaw = [], isLoading } = useQuery({
    queryKey: ['media', 'albums', search],
    queryFn:  () => mediaApi.getAlbums({ q: search || undefined, limit: 100 }),
  })
  const albums = [...albumsRaw].sort((a, b) =>
    sort === 'year'   ? (b.release_year ?? 0) - (a.release_year ?? 0) :
    sort === 'tracks' ? (b.track_count ?? 0) - (a.track_count ?? 0) :
                        a.title.localeCompare(b.title))

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>

  if (!isLoading && albums.length === 0 && !search) {
    return (
      <EmptyState
        icon={<Disc3 className="w-16 h-16" />}
        title="Aucun album"
        subtitle="Scannez vos bibliothèques musicales pour voir vos albums ici."
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-6">
        <SortSelect value={sort} onChange={v => setSort(v as typeof sort)} options={[['title', 'Titre A→Z'], ['year', 'Année'], ['tracks', 'Nb de titres']]} />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {albums.map(a => (
          <AlbumCard key={a.id} album={a} onClick={() => navigate(`/media/listen/album/${a.id}`)} />
        ))}
      </div>
    </div>
  )
}

// ── Sort dropdown ─────────────────────────────────────────────────────────────

function SortSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  const [menu, setMenu] = useState<MenuDropdownPos | null>(null)
  const current = options.find(([v]) => v === value)?.[1] ?? ''
  return (
    <>
      <button
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ top: r.bottom + 4, left: r.right - 200, minWidth: 200 }) }}
        className="inline-flex items-center gap-2 pl-3 pr-3 py-2 bg-surface-2 border border-border rounded-full text-sm text-text-secondary hover:bg-surface-3 transition-colors"
      >
        <ArrowUpDown className="w-3.5 h-3.5 text-text-tertiary" />
        {current}
      </button>
      {menu && (
        <MenuDropdown theme="dark" pos={menu} onClose={() => setMenu(null)}
          items={options.map(([v, label]) => ({
            type: 'action', label, checked: v === value, onClick: () => onChange(v),
          }))} />
      )}
    </>
  )
}

// ── Tab: Playlists ────────────────────────────────────────────────────────────

function PlaylistsTab() {
  const navigate    = useNavigate()
  const qc          = useQueryClient()
  const [dialog,    setDialog]    = useState<'create' | 'edit' | null>(null)
  const [editTarget, setEditTarget] = useState<Playlist | null>(null)

  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ['media', 'playlists'],
    queryFn:  mediaApi.getPlaylists,
  })

  const createMut = useMutation({
    mutationFn: (d: { name: string; description: string; is_public: boolean }) =>
      mediaApi.createPlaylist(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', 'playlists'] })
      setDialog(null)
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...d }: { id: string; name: string; description: string; is_public: boolean }) =>
      mediaApi.updatePlaylist(id, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', 'playlists'] })
      setDialog(null); setEditTarget(null)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => mediaApi.deletePlaylist(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['media', 'playlists'] }),
  })

  const handleRename = (p: Playlist) => { setEditTarget(p); setDialog('edit') }
  const handleDelete = (p: Playlist) => {
    if (confirm(`Supprimer la playlist « ${p.name} » ?`)) deleteMut.mutate(p.id)
  }
  const handleTogglePublic = (p: Playlist) => {
    updateMut.mutate({ id: p.id, name: p.name, description: p.description ?? '', is_public: !p.is_public })
  }

  return (
    <>
      {/* Header with create button */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">{playlists.length > 0 ? `${playlists.length} playlist${playlists.length > 1 ? 's' : ''}` : ''}</p>
        <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setDialog('create')}>
          Nouvelle playlist
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      )}

      {!isLoading && playlists.length === 0 && (
        <EmptyState
          icon={<ListMusic className="w-16 h-16" />}
          title="Aucune playlist"
          subtitle="Cliquez sur « Nouvelle playlist » pour commencer."
        />
      )}

      {!isLoading && playlists.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-w-2xl">
          {playlists.map(p => (
            <PlaylistCard
              key={p.id}
              playlist={p}
              onClick={() => navigate(`/media/listen/playlist/${p.id}`)}
              onRename={() => handleRename(p)}
              onDelete={() => handleDelete(p)}
              onTogglePublic={() => handleTogglePublic(p)}
            />
          ))}
        </div>
      )}

      {dialog === 'create' && (
        <PlaylistDialog
          mode="create"
          onSave={d => createMut.mutate(d)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'edit' && editTarget && (
        <PlaylistDialog
          mode="edit"
          initial={{ name: editTarget.name, description: editTarget.description, is_public: editTarget.is_public }}
          onSave={d => updateMut.mutate({ id: editTarget.id, ...d })}
          onClose={() => { setDialog(null); setEditTarget(null) }}
        />
      )}
    </>
  )
}

// ── Tab: Favoris ──────────────────────────────────────────────────────────────

function LikedTab() {
  const queryClient = useQueryClient()
  const { playTrack, addToQueue } = usePlayerStore()
  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ['media', 'tracks', 'liked'],
    queryFn:  mediaApi.getLikedTracks,
  })
  const toggleLike = useMutation({
    mutationFn: (id: string) => mediaApi.toggleLike(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['media', 'tracks', 'liked'] }),
  })

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>

  if (tracks.length === 0) {
    return (
      <EmptyState
        icon={<Heart className="w-16 h-16" />}
        title="Aucun favori"
        subtitle="Appuyez sur ♡ sur un titre pour l'ajouter à vos favoris."
      />
    )
  }

  const queue = tracks.map(trackToPlayerTrack)

  return (
    <div className="max-w-2xl">
      {tracks.map((t, i) => (
        <TrackRow
          key={t.id} track={t} index={i + 1}
          onPlay={() => playTrack(queue[i], queue, i)}
          onToggleLike={() => toggleLike.mutate(t.id)}
          liked
          onAddToQueue={() => addToQueue(queue[i])}
          playerTrack={queue[i]}
        />
      ))}
    </div>
  )
}

// ── Tab: Recently played ──────────────────────────────────────────────────────

function RecentTab() {
  const queryClient = useQueryClient()
  const { playTrack, addToQueue } = usePlayerStore()
  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ['media', 'tracks', 'recently-played'],
    queryFn:  mediaApi.getRecentlyPlayed,
  })
  const { data: likedTracks = [] } = useQuery({
    queryKey: ['media', 'tracks', 'liked'],
    queryFn:  mediaApi.getLikedTracks,
  })
  const likedIds = new Set(likedTracks.map(t => t.id))
  const toggleLike = useMutation({
    mutationFn: (id: string) => mediaApi.toggleLike(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['media', 'tracks'] }),
  })

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>

  if (tracks.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="w-16 h-16" />}
        title="Aucun historique"
        subtitle="Les titres que vous écoutez apparaîtront ici."
      />
    )
  }

  const queue = tracks.map(trackToPlayerTrack)

  return (
    <div className="max-w-2xl">
      {tracks.map((t, i) => (
        <TrackRow
          key={t.id} track={t} index={i + 1}
          onPlay={() => playTrack(queue[i], queue, i)}
          onToggleLike={() => toggleLike.mutate(t.id)}
          liked={likedIds.has(t.id)}
          onAddToQueue={() => addToQueue(queue[i])}
          playerTrack={queue[i]}
        />
      ))}
    </div>
  )
}

// ── Album detail view ─────────────────────────────────────────────────────────

function AlbumDetailView({ albumId }: { albumId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { playTrack, addToQueue } = usePlayerStore()
  const openIdentify = useIdentifyStore(s => s.open)
  const metaMenu = useMenuDropdown()
  const { data, isLoading } = useQuery({
    queryKey: ['media', 'album', albumId],
    queryFn:  () => mediaApi.getAlbum(albumId),
  })

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
  if (!data) return null

  const { album, tracks } = data
  const cover = album.cover_path ? posterUrl(album.cover_path) : null
  const queue: PlayerTrack[] = tracks.map(t => ({
    id: t.id, title: t.title,
    albumTitle: album.title,
    coverUrl: cover ?? undefined,
    durationSecs: t.duration_secs,
  }))

  const refreshAlbumViews = () => {
    void queryClient.invalidateQueries({ queryKey: ['media', 'album', albumId] })
    void queryClient.invalidateQueries({ queryKey: ['media', 'albums'] })
  }
  const albumLocked = album.meta_locked === true
  const metaItems: MenuItem[] = [
    { type: 'action', icon: <Target className="w-4 h-4" />, label: 'Identifier…',
      onClick: () => openIdentify({ kind: 'album', id: albumId, name: album.title, artist: album.artist_name ?? null }) },
    { type: 'action', icon: <RefreshCw className="w-4 h-4" />, label: 'Rafraîchir les métadonnées',
      disabled: albumLocked,
      onClick: () => {
        void mediaApi.refreshAlbumMeta(albumId).then(() => {
          // Background enrichment — refresh views once it had time to land.
          setTimeout(refreshAlbumViews, 5000)
        }).catch(() => {})
      } },
    { type: 'action', icon: albumLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />,
      label: albumLocked ? 'Déverrouiller les métadonnées' : 'Verrouiller les métadonnées',
      onClick: () => { void mediaApi.lockMeta('albums', albumId, !albumLocked).then(refreshAlbumViews) } },
  ]

  return (
    <div>
      <button
        onClick={() => navigate('/media/listen/albums')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary mb-6 transition-colors"
      >
        ← Albums
      </button>
      <div className="flex gap-6 mb-8 items-end">
        <div className="w-40 h-40 rounded-xl overflow-hidden flex-shrink-0 bg-surface-2 flex items-center justify-center shadow-md">
          {cover
            ? <img src={cover} alt={album.title} className="w-full h-full object-cover" />
            : <Disc3 className="w-12 h-12 text-text-tertiary" />
          }
        </div>
        <div>
          <p className="text-xs text-text-tertiary uppercase tracking-widest mb-1">
            {album.album_type && album.album_type !== 'Album' ? album.album_type : 'Album'}
          </p>
          <h2 className="text-3xl font-bold text-text-primary mb-1">{album.title}</h2>
          {album.artist_name && (
            <button
              onClick={() => album.artist_id && navigate(`/media/listen/artist/${album.artist_id}`)}
              className="text-sm font-medium text-text-primary hover:text-primary transition-colors mb-1"
            >
              {album.artist_name}
            </button>
          )}
          <p className="text-sm text-text-secondary">
            {[album.release_year, `${tracks.length} titres`, formatDuration(album.duration_secs), album.label]
              .filter(Boolean).join(' · ')}
          </p>
          {(album.genres?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {album.genres.map(g => (
                <span key={g} className="px-2 py-0.5 rounded-full bg-surface-2 text-text-secondary text-xs border border-border">
                  {g}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-4">
            <Button icon={<Play size={15} fill="white" />} onClick={() => tracks.length > 0 && playTrack(queue[0], queue, 0)}>
              Lecture
            </Button>
            <Button variant="secondary" icon={<Shuffle size={15} />} onClick={() => playShuffled(queue)}>
              Aléatoire
            </Button>
            <Button variant="secondary" icon={<MoreHorizontal size={15} />} onClick={metaMenu.open} aria-label="Plus d'options" />
          </div>
          {metaMenu.isOpen && metaMenu.pos && (
            <MenuDropdown pos={metaMenu.pos} onClose={metaMenu.close} items={metaItems} />
          )}
        </div>
      </div>
      <div className="max-w-2xl">
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id} track={t} index={i + 1}
            onPlay={() => playTrack(queue[i], queue, i)}
            onToggleLike={() => {}}
            liked={false}
            onAddToQueue={() => addToQueue(queue[i])}
            playerTrack={queue[i]}
          />
        ))}
      </div>
    </div>
  )
}

// ── Artist detail view ────────────────────────────────────────────────────────

function ArtistDetailView({ artistId }: { artistId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { playTrack, addToQueue } = usePlayerStore()
  const openIdentify = useIdentifyStore(s => s.open)
  const metaMenu = useMenuDropdown()
  const [bioExpanded, setBioExpanded] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['media', 'artist', artistId],
    queryFn:  () => mediaApi.getArtist(artistId),
  })

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
  if (!data) return null

  const topTracks: PlayerTrack[] = data.top_tracks.map(t => ({
    id: t.id, title: t.title, durationSecs: t.duration_secs,
  }))

  // "1969 – 1980" / "Depuis 1969" activity span from MusicBrainz dates.
  const beginYear = data.begin_date?.slice(0, 4) ?? null
  const endYear   = data.end_date?.slice(0, 4) ?? null
  const years = beginYear ? (endYear ? `${beginYear} – ${endYear}` : `Depuis ${beginYear}`) : null

  const refreshArtistViews = () => {
    void queryClient.invalidateQueries({ queryKey: ['media', 'artist', artistId] })
    void queryClient.invalidateQueries({ queryKey: ['media', 'artists'] })
  }
  const artistLocked = data.meta_locked === true
  const metaItems: MenuItem[] = [
    { type: 'action', icon: <Target className="w-4 h-4" />, label: 'Identifier…',
      onClick: () => openIdentify({ kind: 'artist', id: artistId, name: data.name }) },
    { type: 'action', icon: <RefreshCw className="w-4 h-4" />, label: 'Rafraîchir les métadonnées',
      disabled: artistLocked,
      onClick: () => {
        void mediaApi.refreshArtistMeta(artistId).then(() => {
          // Background enrichment — refresh views once it had time to land.
          setTimeout(refreshArtistViews, 5000)
        }).catch(() => {})
      } },
    { type: 'action', icon: artistLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />,
      label: artistLocked ? 'Déverrouiller les métadonnées' : 'Verrouiller les métadonnées',
      onClick: () => { void mediaApi.lockMeta('artists', artistId, !artistLocked).then(refreshArtistViews) } },
  ]

  return (
    <div>
      <button
        onClick={() => navigate('/media/listen')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary mb-6 transition-colors"
      >
        ← Artistes
      </button>

      {/* Header */}
      <div className="flex gap-6 mb-8 items-end">
        <div className="w-36 h-36 rounded-full overflow-hidden flex-shrink-0 bg-surface-2 flex items-center justify-center shadow-md">
          {data.image_path
            ? <img src={data.image_path} alt={data.name} className="w-full h-full object-cover" />
            : <Mic2 className="w-12 h-12 text-text-tertiary" />
          }
        </div>
        <div>
          <p className="text-xs text-text-tertiary uppercase tracking-widest mb-1">
            {data.artist_type === 'Group' ? 'Groupe' : 'Artiste'}
          </p>
          <h2 className="text-3xl font-bold text-text-primary mb-1">{data.name}</h2>
          {(data.genres?.length ?? 0) > 0 && (
            <p className="text-sm text-text-secondary mb-2">{data.genres!.join(', ')}</p>
          )}
          <p className="text-sm text-text-tertiary">
            {[data.album_count > 0 ? `${data.album_count} album${data.album_count > 1 ? 's' : ''}` : null,
              data.country ?? null,
              years].filter(Boolean).join(' · ')}
          </p>
          <div className="flex items-center gap-2 mt-4">
            {data.top_tracks.length > 0 && (
              <>
                <Button icon={<Play size={15} fill="white" />} onClick={() => playTrack(topTracks[0], topTracks, 0)}>
                  Lecture
                </Button>
                <Button variant="secondary" icon={<Shuffle size={15} />} onClick={() => playShuffled(topTracks)}>
                  Aléatoire
                </Button>
              </>
            )}
            <Button variant="secondary" icon={<MoreHorizontal size={15} />} onClick={metaMenu.open} aria-label="Plus d'options" />
          </div>
          {metaMenu.isOpen && metaMenu.pos && (
            <MenuDropdown pos={metaMenu.pos} onClose={metaMenu.close} items={metaItems} />
          )}
        </div>
      </div>

      {/* Biographie */}
      {data.biography && (
        <div className="mb-8 max-w-2xl">
          <h3 className="text-sm font-semibold text-text-primary mb-2">Biographie</h3>
          <p className={`text-sm text-text-secondary leading-relaxed ${bioExpanded ? '' : 'line-clamp-4'}`}>
            {data.biography}
          </p>
          {data.biography.length > 280 && (
            <button
              onClick={() => setBioExpanded(v => !v)}
              className="text-xs text-primary hover:underline mt-1"
            >
              {bioExpanded ? 'Réduire' : 'Lire la suite'}
            </button>
          )}
        </div>
      )}

      {/* Top titres */}
      {data.top_tracks.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Titres populaires</h3>
          <div className="max-w-2xl">
            {data.top_tracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={{ id: t.id, title: t.title, duration_secs: t.duration_secs, artist_id: artistId, album_id: t.album_id ?? null, track_number: null, codec: null, bitrate: null, play_count: t.play_count }}
                index={i + 1}
                onPlay={() => playTrack(topTracks[i], topTracks, i)}
                onToggleLike={() => {}}
                liked={false}
                onAddToQueue={() => addToQueue(topTracks[i])}
                playerTrack={topTracks[i]}
              />
            ))}
          </div>
        </div>
      )}

      {/* Albums */}
      {data.albums.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-3">Albums</h3>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {data.albums.map(a => (
              <AlbumCard
                key={a.id}
                album={{ id: a.id, title: a.title, release_year: a.release_year, cover_path: a.cover_path, artist_id: artistId, track_count: a.track_count, duration_secs: 0, genres: [], label: null }}
                onClick={() => navigate(`/media/listen/album/${a.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ListenPage ───────────────────────────────────────────────────────────

type Tab = 'artists' | 'albums' | 'playlists' | 'liked' | 'recent'

const TAB_PATHS: Record<string, Tab> = {
  '/media/listen':           'artists',
  '/media/listen/albums':    'albums',
  '/media/listen/playlists': 'playlists',
  '/media/listen/liked':     'liked',
  '/media/listen/recent':    'recent',
}

export default function ListenPage() {
  const navigate     = useNavigate()
  const { pathname } = useLocation()

  // Handle detail pages
  const albumMatch  = pathname.match(/^\/media\/listen\/album\/(.+)$/)
  const artistMatch = pathname.match(/^\/media\/listen\/artist\/(.+)$/)

  const tab: Tab = TAB_PATHS[pathname] ?? 'artists'
  const [libPanelOpen, setLibPanelOpen] = useState(false)

  const { data: libraries = [] } = useQuery({
    queryKey: ['media', 'libraries'],
    queryFn:  mediaApi.getLibraries,
  })
  const isScanning = libraries.some(l => l.scan_status === 'scanning')

  const TABS = [
    { id: 'artists'   as Tab, label: 'Artistes',  icon: Mic2,       path: '/media/listen' },
    { id: 'albums'    as Tab, label: 'Albums',    icon: Disc3,      path: '/media/listen/albums' },
    { id: 'playlists' as Tab, label: 'Playlists', icon: ListMusic,  path: '/media/listen/playlists' },
    { id: 'liked'     as Tab, label: 'Favoris',   icon: Heart,      path: '/media/listen/liked' },
    { id: 'recent'    as Tab, label: 'Récents',   icon: Clock,      path: '/media/listen/recent' },
  ]

  return (
    <div className="flex flex-col h-full" style={DARK_PAGE}>
      {/* Dark hero banner + pill tabs */}
      <div className="flex-shrink-0 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #1b1730 0%, #241a3a 55%, #181527 100%)' }}>
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(95% 130% at 0% 0%, rgba(47,125,255,0.38) 0%, rgba(47,125,255,0.12) 38%, rgba(0,0,0,0) 72%)' }} />
        <div className="relative px-6 pt-6 pb-6">
          <div className="flex items-end justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                   style={{ background: 'linear-gradient(135deg, #5aa0ff, #1f66e8)' }}>
                <Music className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-white leading-none">Écouter</h1>
                <p className="text-xs text-white/55 mt-1.5">Votre musique, vos artistes, vos playlists</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<Sliders size={15} />} onClick={() => navigate('/media/listen/dj')}>
                Table de mixage
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

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {albumMatch  ? <AlbumDetailView albumId={albumMatch[1]} /> :
         artistMatch ? <ArtistDetailView artistId={artistMatch[1]} /> :
         tab === 'artists'   ? <ArtistsTab />   :
         tab === 'albums'    ? <AlbumsTab />    :
         tab === 'playlists' ? <PlaylistsTab /> :
         tab === 'liked'     ? <LikedTab />     :
                               <RecentTab />
        }
      </div>

      <MediaLibrariesPanel open={libPanelOpen} onClose={() => setLibPanelOpen(false)} />
    </div>
  )
}
