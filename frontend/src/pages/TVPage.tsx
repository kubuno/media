import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Tv, Heart, HeartOff, Plus, Search, Play, Trash2, X, Globe, Loader2, Link2, ExternalLink, Maximize2,
} from 'lucide-react'
import { Button, Input, ConfirmDialog, MenuDropdown, type MenuDropdownPos, type MenuItem } from '@ui'
import { useConfirm } from '@kubuno/sdk'
import { mediaApi, type TvChannel, type TvDiscoverResult } from '../api'
import { DARK_PAGE } from '../darkTheme'

type Tab = 'all' | 'favorites' | 'recent' | 'mine'

// ── Live player (HLS via hls.js, native fallback on Safari) ──────────────────

function LivePlayer({ channel, onClose }: { channel: TvChannel; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    setError(null)
    let hls: { destroy: () => void } | null = null
    let cancelled = false

    const src = channel.stream_url

    async function attach() {
      const v = videoRef.current
      if (!v) return
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari)
        v.src = src
        v.play().catch(() => {})
        return
      }
      const { default: Hls } = await import('hls.js')
      if (cancelled) return
      if (!Hls.isSupported()) {
        setError('Lecture HLS non supportée par ce navigateur.')
        return
      }
      const instance = new Hls({ maxBufferLength: 20 })
      hls = instance
      instance.loadSource(src)
      instance.attachMedia(v)
      instance.on(Hls.Events.MANIFEST_PARSED, () => { v.play().catch(() => {}) })
      instance.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean; type?: string }) => {
        if (data.fatal) {
          setError('Flux indisponible — la chaîne est peut-être hors ligne.')
          instance.destroy()
        }
      })
    }
    void attach()

    return () => {
      cancelled = true
      hls?.destroy()
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [channel.id, channel.stream_url])

  return (
    <div className="mb-6 rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.04]">
        <div className="flex items-center gap-2.5 min-w-0">
          {channel.logo && <img src={channel.logo} alt="" className="w-6 h-6 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
          <p className="text-sm font-semibold text-white truncate">{channel.name}</p>
          <span className="flex items-center gap-1.5 flex-shrink-0 px-1.5 py-0.5 rounded bg-red-600/90 text-white text-[10px] font-bold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Direct
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => videoRef.current?.requestFullscreen().catch(() => {})}
            className="p-1.5 rounded-md text-white/60 hover:text-white transition-colors" title="Plein écran">
            <Maximize2 size={15} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-md text-white/60 hover:text-white transition-colors" title="Fermer">
            <X size={16} />
          </button>
        </div>
      </div>
      {error ? (
        <div className="aspect-video flex items-center justify-center text-sm text-white/60 px-6 text-center">{error}</div>
      ) : (
        <video ref={videoRef} controls playsInline className="w-full aspect-video bg-black" />
      )}
    </div>
  )
}

// ── Channel card ──────────────────────────────────────────────────────────────

function ChannelCard({ ch, active, onPlay, onFav, onDelete }: {
  ch: TvChannel
  active: boolean
  onPlay: (ch: TvChannel) => void
  onFav: (ch: TvChannel) => void
  onDelete: (ch: TvChannel) => void
}) {
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  const menuItems: MenuItem[] = [
    { type: 'action', icon: <Play className="w-4 h-4" />, label: 'Regarder', onClick: () => onPlay(ch) },
    { type: 'action', icon: ch.is_favorite ? <HeartOff className="w-4 h-4" /> : <Heart className="w-4 h-4" />, label: ch.is_favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', onClick: () => onFav(ch) },
    { type: 'action', icon: <Link2 className="w-4 h-4" />, label: "Copier l'URL du flux", onClick: () => { navigator.clipboard?.writeText(window.location.origin + ch.stream_url).catch(() => {}) } },
    ...(ch.homepage ? [{ type: 'action' as const, icon: <ExternalLink className="w-4 h-4" />, label: 'Site de la chaîne', onClick: () => window.open(ch.homepage!, '_blank', 'noopener') }] : []),
    ...(ch.is_custom ? [
      { type: 'separator' as const },
      { type: 'action' as const, icon: <Trash2 className="w-4 h-4" />, label: 'Supprimer', danger: true, onClick: () => onDelete(ch) },
    ] : []),
  ]

  return (
    <div
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ top: e.clientY, left: e.clientX }) }}
      className={`group relative flex flex-col rounded-xl border p-3 transition-colors ${
        active ? 'border-primary bg-primary/5' : 'border-border bg-surface-1 hover:bg-surface-2'
      }`}>
      {ctx && <MenuDropdown theme="dark" pos={ctx} onClose={() => setCtx(null)} items={menuItems} />}
      <div className="flex items-start gap-3">
        <button
          onClick={() => onPlay(ch)}
          className="relative flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"
          title="Regarder"
        >
          {ch.logo
            ? <img src={ch.logo} alt="" className="w-full h-full object-contain p-1" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            : <Tv size={22} className="text-primary/60" />}
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play size={20} className="text-white" fill="white" />
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-text-primary truncate">{ch.name}</p>
            {active && <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />}
          </div>
          <p className="text-xs text-text-tertiary truncate mt-0.5">
            {[ch.country, ch.language?.toUpperCase()].filter(Boolean).join(' · ')}
          </p>
          {ch.categories?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {ch.categories.slice(0, 3).map(cat => (
                <span key={cat} className="px-1.5 py-0.5 rounded bg-surface-3 text-[10px] text-text-secondary">{cat}</span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-1">
          <button onClick={() => onFav(ch)} title="Favori"
            className={`p-1 rounded-md transition-colors ${ch.is_favorite ? 'text-danger' : 'text-text-tertiary hover:text-danger'}`}>
            <Heart size={16} fill={ch.is_favorite ? 'currentColor' : 'none'} />
          </button>
          {ch.is_custom && (
            <button onClick={() => onDelete(ch)} title="Supprimer"
              className="p-1 rounded-md text-text-tertiary hover:text-danger transition-colors">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Add dialog ────────────────────────────────────────────────────────────────

interface FormState { name: string; stream_url: string; homepage: string; categories: string; country: string }
const emptyForm: FormState = { name: '', stream_url: '', homepage: '', categories: '', country: '' }

function ChannelFormDialog({ onClose, onSave }: {
  onClose: () => void
  onSave: (dto: { name: string; stream_url: string; homepage?: string; categories?: string[]; country?: string }) => void
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = () => {
    if (!form.name.trim() || !form.stream_url.trim()) return
    onSave({
      name: form.name.trim(),
      stream_url: form.stream_url.trim(),
      homepage: form.homepage.trim() || undefined,
      country: form.country.trim() || undefined,
      categories: form.categories.split(',').map(s => s.trim()).filter(Boolean),
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[440px] max-w-[92vw] rounded-2xl bg-surface-1 shadow-2xl border border-border p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">Ajouter une chaîne</h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Nom</span>
            <Input value={form.name} onChange={set('name')} placeholder="Ma chaîne" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">URL du flux (HLS .m3u8)</span>
            <Input value={form.stream_url} onChange={set('stream_url')} placeholder="https://exemple.com/live/master.m3u8" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-text-secondary">Pays</span>
              <Input value={form.country} onChange={set('country')} placeholder="France" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-text-secondary">Catégories</span>
              <Input value={form.categories} onChange={set('categories')} placeholder="info, sport" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Site web</span>
            <Input value={form.homepage} onChange={set('homepage')} placeholder="https://…" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={!form.name.trim() || !form.stream_url.trim()}>Enregistrer</Button>
        </div>
      </div>
    </div>
  )
}

// ── Discover dialog (iptv-org) ────────────────────────────────────────────────

function DiscoverDialog({ onClose, onAdd }: {
  onClose: () => void
  onAdd: (r: TvDiscoverResult) => void
}) {
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['tv-discover', submitted],
    queryFn: () => mediaApi.discoverTv(submitted),
    enabled: submitted.length > 1,
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[520px] max-w-[94vw] max-h-[80vh] flex flex-col rounded-2xl bg-surface-1 shadow-2xl border border-border p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-text-primary flex items-center gap-2"><Globe size={18} /> Découvrir des chaînes</h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); setSubmitted(q.trim()) }} className="flex gap-2 mb-3">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Nom de chaîne…" autoFocus />
          <Button type="submit">Rechercher</Button>
        </form>
        <p className="text-[11px] text-text-tertiary mb-2">
          Catalogue communautaire iptv-org — flux publics diffusés par les chaînes elles-mêmes.
        </p>
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {isFetching && <div className="flex items-center justify-center py-8 text-text-tertiary"><Loader2 className="animate-spin" size={20} /></div>}
          {!isFetching && submitted && results.length === 0 && (
            <p className="text-center text-sm text-text-tertiary py-8">Aucun résultat.</p>
          )}
          <div className="space-y-1.5">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-2 hover:bg-surface-2">
                <div className="w-12 h-9 rounded-md bg-surface-3 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {r.logo ? <img src={r.logo} alt="" className="w-full h-full object-contain p-0.5" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <Tv size={16} className="text-text-tertiary" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">{r.name}</p>
                  <p className="text-xs text-text-tertiary truncate">{[r.country, r.categories.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}</p>
                </div>
                <Button size="sm" variant="ghost" disabled={!r.stream_url} onClick={() => onAdd(r)}>
                  <Plus size={14} /> Ajouter
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TVPage() {
  const { t } = useTranslation('media')
  const qc = useQueryClient()
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const [tab, setTab]       = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showDiscover, setShowDiscover] = useState(false)
  const [playing, setPlaying] = useState<TvChannel | null>(null)

  const channelsQ = useQuery({
    queryKey: ['tv-channels', tab, search, category],
    queryFn: () => {
      if (tab === 'favorites') return mediaApi.getTvFavorites()
      if (tab === 'recent')    return mediaApi.getTvRecent()
      return mediaApi.getTvChannels({ q: search || undefined, category: category || undefined, mine: tab === 'mine' || undefined })
    },
  })
  const categoriesQ = useQuery({ queryKey: ['tv-categories'], queryFn: () => mediaApi.getTvCategories() })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tv-channels'] })
    qc.invalidateQueries({ queryKey: ['tv-categories'] })
  }

  const favMut = useMutation({
    mutationFn: (ch: TvChannel) => mediaApi.toggleTvFavorite(ch.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tv-channels'] }) },
  })
  const saveMut = useMutation({
    mutationFn: (dto: { name: string; stream_url: string; homepage?: string; logo?: string; categories?: string[]; country?: string }) =>
      mediaApi.createTvChannel(dto),
    onSuccess: () => { setShowForm(false); invalidate() },
  })
  const delMut = useMutation({
    mutationFn: (ch: TvChannel) => mediaApi.deleteTvChannel(ch.id),
    onSuccess: invalidate,
  })

  const onDelete = async (ch: TvChannel) => {
    const ok = await confirm({ title: 'Supprimer', message: `Supprimer la chaîne « ${ch.name} » ?`, confirmLabel: 'Supprimer', variant: 'danger' })
    if (ok) {
      if (playing?.id === ch.id) setPlaying(null)
      delMut.mutate(ch)
    }
  }

  const onPlay = (ch: TvChannel) => {
    setPlaying(ch)
    mediaApi.recordTvPlay(ch.id)
  }

  const channels = channelsQ.data ?? []
  const categories = categoriesQ.data ?? []

  const TABS: Array<{ id: Tab; label: string }> = useMemo(() => [
    { id: 'all',       label: t('media_tv_tab_all', { defaultValue: 'Toutes' }) },
    { id: 'favorites', label: t('media_tv_tab_favorites', { defaultValue: 'Favoris' }) },
    { id: 'recent',    label: t('media_tv_tab_recent', { defaultValue: 'Récentes' }) },
    { id: 'mine',      label: t('media_tv_tab_mine', { defaultValue: 'Mes chaînes' }) },
  ], [t])

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
                <Tv className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-white leading-none">{t('media_tv_title', { defaultValue: 'TV en direct' })}</h1>
                <p className="text-xs text-white/55 mt-1.5">Chaînes en direct du monde entier</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<Globe size={15} />} onClick={() => setShowDiscover(true)}>Découvrir</Button>
              <Button size="sm" icon={<Plus size={15} />} onClick={() => setShowForm(true)}>Ajouter</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map(tb => {
              const active = tab === tb.id
              return (
                <Button key={tb.id} size="sm" variant={active ? 'primary' : 'ghost'}
                  onClick={() => setTab(tb.id)}
                  className={active ? undefined : 'text-white/75 hover:text-white hover:bg-white/10'}>
                  {tb.label}
                </Button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-6">

        {/* Live player */}
        {playing && <LivePlayer channel={playing} onClose={() => setPlaying(null)} />}

        {/* Search + category filter (only on "all") */}
        {tab === 'all' && (
          <>
            <div className="flex items-center gap-2 bg-surface-2 rounded-lg px-3 py-2 mb-3 max-w-md">
              <Search size={15} className="text-text-tertiary" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une chaîne…"
                className="bg-transparent text-sm text-text-primary outline-none w-full" />
            </div>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                <button onClick={() => setCategory(null)}
                  className={`px-2 py-1 rounded-full text-xs transition-colors ${!category ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'}`}>
                  Toutes catégories
                </button>
                {categories.slice(0, 24).map(({ category: cat, count }) => (
                  <button key={cat} onClick={() => setCategory(cat === category ? null : cat)}
                    className={`px-2 py-1 rounded-full text-xs transition-colors ${cat === category ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'}`}>
                    {cat} <span className="opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Grid */}
        {channelsQ.isLoading ? (
          <div className="flex items-center justify-center py-16 text-text-tertiary"><Loader2 className="animate-spin" size={24} /></div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <Tv size={36} className="mb-2 opacity-50" />
            <p className="text-sm">Aucune chaîne — ajoutez la vôtre ou découvrez-en.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {channels.map(ch => (
              <ChannelCard key={ch.id} ch={ch}
                active={playing?.id === ch.id}
                onPlay={onPlay}
                onFav={c2 => favMut.mutate(c2)}
                onDelete={onDelete} />
            ))}
          </div>
        )}
        </div>
      </div>

      {showForm && (
        <ChannelFormDialog
          onClose={() => setShowForm(false)}
          onSave={dto => saveMut.mutate(dto)} />
      )}
      {showDiscover && (
        <DiscoverDialog
          onClose={() => setShowDiscover(false)}
          onAdd={r => {
            saveMut.mutate({ name: r.name, stream_url: r.stream_url, homepage: r.homepage ?? undefined, logo: r.logo ?? undefined, country: r.country ?? undefined, categories: r.categories })
            setShowDiscover(false)
          }} />
      )}
      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </div>
  )
}
