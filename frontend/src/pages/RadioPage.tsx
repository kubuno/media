import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Radio, Heart, HeartOff, Plus, Search, Play, Pause, Pencil, Trash2, X, Globe, Loader2, Music2, Link2, ExternalLink,
} from 'lucide-react'
import { Button, Input, ConfirmDialog, MenuDropdown, type MenuDropdownPos, type MenuItem } from '@ui'
import { useConfirm } from '@kubuno/sdk'
import { mediaApi, type RadioStation, type RadioDiscoverResult } from '../api'
import { usePlayerStore } from '../store/playerStore'

type Tab = 'all' | 'favorites' | 'recent' | 'mine'

// ── Play helper ───────────────────────────────────────────────────────────────

function playStation(st: RadioStation) {
  usePlayerStore.getState().playTrack({
    id:           st.id,
    title:        st.name,
    artistName:   st.tags?.slice(0, 3).join(' · ') || st.country || 'Radio',
    coverUrl:     st.favicon || undefined,
    durationSecs: 0,
    streamUrl:    st.stream_url,
    isRadio:      true,
  })
  mediaApi.recordRadioPlay(st.id)
}

// ── Station card ──────────────────────────────────────────────────────────────

function StationCard({ st, onFav, onEdit, onDelete }: {
  st: RadioStation
  onFav: (st: RadioStation) => void
  onEdit: (st: RadioStation) => void
  onDelete: (st: RadioStation) => void
}) {
  const { t } = useTranslation('media')
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const isPlaying    = usePlayerStore(s => s.isPlaying)
  const active       = currentTrack?.id === st.id
  const playing      = active && isPlaying
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  const menuItems: MenuItem[] = [
    { type: 'action', icon: <Play className="w-4 h-4" />, label: t('media_radio_play'), onClick: () => playStation(st) },
    { type: 'action', icon: st.is_favorite ? <HeartOff className="w-4 h-4" /> : <Heart className="w-4 h-4" />, label: t('media_radio_favorite'), onClick: () => onFav(st) },
    { type: 'action', icon: <Link2 className="w-4 h-4" />, label: t('media_radio_copy_url'), onClick: () => { navigator.clipboard?.writeText(window.location.origin + st.stream_url).catch(() => {}) } },
    ...(st.homepage ? [{ type: 'action' as const, icon: <ExternalLink className="w-4 h-4" />, label: t('media_radio_open_site'), onClick: () => window.open(st.homepage!, '_blank', 'noopener') }] : []),
    ...(st.is_custom ? [
      { type: 'separator' as const },
      { type: 'action' as const, icon: <Pencil className="w-4 h-4" />, label: t('media_radio_edit'), onClick: () => onEdit(st) },
      { type: 'action' as const, icon: <Trash2 className="w-4 h-4" />, label: t('media_radio_delete'), danger: true, onClick: () => onDelete(st) },
    ] : []),
  ]

  return (
    <div
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ top: e.clientY, left: e.clientX }) }}
      className={`group relative flex flex-col rounded-xl border p-3 transition-colors ${
      active ? 'border-primary bg-primary/5' : 'border-border bg-surface-1 hover:bg-surface-2'
    }`}>
      {ctx && <MenuDropdown pos={ctx} onClose={() => setCtx(null)} items={menuItems} />}
      <div className="flex items-start gap-3">
        <button
          onClick={() => (playing ? usePlayerStore.getState().togglePlay() : playStation(st))}
          className="relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"
          title={t('media_radio_play')}
        >
          {st.favicon
            ? <img src={st.favicon} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            : <Radio size={24} className="text-primary/60" />}
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            {playing ? <Pause size={20} className="text-white" fill="white" /> : <Play size={20} className="text-white" fill="white" />}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-text-primary truncate">{st.name}</p>
            {playing && <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />}
          </div>
          <p className="text-xs text-text-tertiary truncate mt-0.5">
            {[st.country, st.bitrate ? `${st.bitrate} kbps` : null].filter(Boolean).join(' · ')}
          </p>
          {st.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {st.tags.slice(0, 3).map(tag => (
                <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-3 text-[10px] text-text-secondary">{tag}</span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-1">
          <button onClick={() => onFav(st)} title={t('media_radio_favorite')}
            className={`p-1 rounded-md transition-colors ${st.is_favorite ? 'text-danger' : 'text-text-tertiary hover:text-danger'}`}>
            <Heart size={16} fill={st.is_favorite ? 'currentColor' : 'none'} />
          </button>
          {st.is_custom && (
            <>
              <button onClick={() => onEdit(st)} title={t('media_radio_edit')}
                className="p-1 rounded-md text-text-tertiary hover:text-text-primary transition-colors">
                <Pencil size={14} />
              </button>
              <button onClick={() => onDelete(st)} title={t('media_radio_delete')}
                className="p-1 rounded-md text-text-tertiary hover:text-danger transition-colors">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Add / edit dialog ─────────────────────────────────────────────────────────

interface FormState { name: string; stream_url: string; homepage: string; tags: string; country: string }
const emptyForm: FormState = { name: '', stream_url: '', homepage: '', tags: '', country: '' }

function StationFormDialog({ initial, onClose, onSave }: {
  initial: RadioStation | null
  onClose: () => void
  onSave: (dto: { name: string; stream_url: string; homepage?: string; tags?: string[]; country?: string }) => void
}) {
  const { t } = useTranslation('media')
  const [form, setForm] = useState<FormState>(initial
    ? { name: initial.name, stream_url: initial.stream_url.startsWith('/api/') ? '' : initial.stream_url, homepage: initial.homepage ?? '', tags: (initial.tags ?? []).join(', '), country: initial.country ?? '' }
    : emptyForm)
  // For an existing custom station the stream_url is proxied; keep the real one editable
  // only when the user re-enters it. We surface a hint instead.
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = () => {
    if (!form.name.trim() || !form.stream_url.trim()) return
    onSave({
      name: form.name.trim(),
      stream_url: form.stream_url.trim(),
      homepage: form.homepage.trim() || undefined,
      country: form.country.trim() || undefined,
      tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[440px] max-w-[92vw] rounded-2xl bg-surface-1 shadow-2xl border border-border p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">{initial ? t('media_radio_edit') : t('media_radio_add')}</h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">{t('media_radio_field_name')}</span>
            <Input value={form.name} onChange={set('name')} placeholder="Ma radio" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">{t('media_radio_field_url')}</span>
            <Input value={form.stream_url} onChange={set('stream_url')} placeholder="https://stream.example.com/radio.mp3" />
            {initial && <span className="text-[11px] text-text-tertiary">{t('media_radio_url_hint')}</span>}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-text-secondary">{t('media_radio_field_country')}</span>
              <Input value={form.country} onChange={set('country')} placeholder="France" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-text-secondary">{t('media_radio_field_tags')}</span>
              <Input value={form.tags} onChange={set('tags')} placeholder="jazz, chill" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">{t('media_radio_field_homepage')}</span>
            <Input value={form.homepage} onChange={set('homepage')} placeholder="https://…" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>{t('media_radio_cancel')}</Button>
          <Button onClick={submit} disabled={!form.name.trim() || !form.stream_url.trim()}>{t('media_radio_save')}</Button>
        </div>
      </div>
    </div>
  )
}

// ── Discover dialog (Radio Browser) ─────────────────────────────────────────────

function DiscoverDialog({ onClose, onAdd }: {
  onClose: () => void
  onAdd: (r: RadioDiscoverResult) => void
}) {
  const { t } = useTranslation('media')
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['radio-discover', submitted],
    queryFn: () => mediaApi.discoverRadio(submitted),
    enabled: submitted.length > 1,
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[520px] max-w-[94vw] max-h-[80vh] flex flex-col rounded-2xl bg-surface-1 shadow-2xl border border-border p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-text-primary flex items-center gap-2"><Globe size={18} /> {t('media_radio_discover')}</h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); setSubmitted(q.trim()) }} className="flex gap-2 mb-3">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t('media_radio_discover_placeholder')} autoFocus />
          <Button type="submit">{t('media_radio_search')}</Button>
        </form>
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {isFetching && <div className="flex items-center justify-center py-8 text-text-tertiary"><Loader2 className="animate-spin" size={20} /></div>}
          {!isFetching && submitted && results.length === 0 && (
            <p className="text-center text-sm text-text-tertiary py-8">{t('media_radio_no_results')}</p>
          )}
          <div className="space-y-1.5">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-2 hover:bg-surface-2">
                <div className="w-9 h-9 rounded-md bg-surface-3 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {r.favicon ? <img src={r.favicon} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <Radio size={16} className="text-text-tertiary" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">{r.name}</p>
                  <p className="text-xs text-text-tertiary truncate">{[r.country, r.codec, r.bitrate ? `${r.bitrate} kbps` : null].filter(Boolean).join(' · ')}</p>
                </div>
                <Button size="sm" variant="ghost" disabled={!r.stream_url} onClick={() => onAdd(r)}>
                  <Plus size={14} /> {t('media_radio_add_short')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function RadioPage() {
  const { t } = useTranslation('media')
  const qc = useQueryClient()
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const [tab, setTab]       = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [tag, setTag]       = useState<string | null>(null)
  const [showForm, setShowForm]       = useState(false)
  const [editing, setEditing]         = useState<RadioStation | null>(null)
  const [showDiscover, setShowDiscover] = useState(false)

  const stationsQ = useQuery({
    queryKey: ['radio-stations', tab, search, tag],
    queryFn: () => {
      if (tab === 'favorites') return mediaApi.getRadioFavorites()
      if (tab === 'recent')    return mediaApi.getRadioRecent()
      return mediaApi.getRadioStations({ q: search || undefined, tag: tag || undefined, mine: tab === 'mine' || undefined })
    },
  })
  const tagsQ = useQuery({ queryKey: ['radio-tags'], queryFn: () => mediaApi.getRadioTags() })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['radio-stations'] })
    qc.invalidateQueries({ queryKey: ['radio-tags'] })
  }

  const favMut = useMutation({
    mutationFn: (st: RadioStation) => mediaApi.toggleRadioFavorite(st.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['radio-stations'] }) },
  })
  const saveMut = useMutation({
    mutationFn: (dto: { name: string; stream_url: string; homepage?: string; tags?: string[]; country?: string }) =>
      editing ? mediaApi.updateRadioStation(editing.id, dto) : mediaApi.createRadioStation(dto),
    onSuccess: () => { setShowForm(false); setEditing(null); invalidate() },
  })
  const delMut = useMutation({
    mutationFn: (st: RadioStation) => mediaApi.deleteRadioStation(st.id),
    onSuccess: invalidate,
  })

  const onDelete = async (st: RadioStation) => {
    const ok = await confirm({ title: t('media_radio_delete'), message: t('media_radio_delete_confirm', { name: st.name }), confirmLabel: t('media_radio_delete'), variant: 'danger' })
    if (ok) delMut.mutate(st)
  }

  const stations = stationsQ.data ?? []
  const tags = tagsQ.data ?? []

  const TABS: Array<{ id: Tab; label: string }> = useMemo(() => [
    { id: 'all',       label: t('media_radio_tab_all') },
    { id: 'favorites', label: t('media_radio_tab_favorites') },
    { id: 'recent',    label: t('media_radio_tab_recent') },
    { id: 'mine',      label: t('media_radio_tab_mine') },
  ], [t])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2"><Radio size={22} /> {t('media_radio_title')}</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setShowDiscover(true)}><Globe size={16} /> {t('media_radio_discover')}</Button>
            <Button onClick={() => { setEditing(null); setShowForm(true) }}><Plus size={16} /> {t('media_radio_add')}</Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-3">
          {TABS.map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === tb.id ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-2'
              }`}>
              {tb.label}
            </button>
          ))}
        </div>

        {/* Search + tag filter (only on "all") */}
        {tab === 'all' && (
          <>
            <div className="flex items-center gap-2 bg-surface-2 rounded-lg px-3 py-2 mb-3 max-w-md">
              <Search size={15} className="text-text-tertiary" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('media_radio_search_placeholder')}
                className="bg-transparent text-sm text-text-primary outline-none w-full" />
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                <button onClick={() => setTag(null)}
                  className={`px-2 py-1 rounded-full text-xs transition-colors ${!tag ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'}`}>
                  {t('media_radio_all_genres')}
                </button>
                {tags.slice(0, 24).map(({ tag: tg, count }) => (
                  <button key={tg} onClick={() => setTag(tg === tag ? null : tg)}
                    className={`px-2 py-1 rounded-full text-xs transition-colors ${tg === tag ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'}`}>
                    {tg} <span className="opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Grid */}
        {stationsQ.isLoading ? (
          <div className="flex items-center justify-center py-16 text-text-tertiary"><Loader2 className="animate-spin" size={24} /></div>
        ) : stations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <Music2 size={36} className="mb-2 opacity-50" />
            <p className="text-sm">{t('media_radio_empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stations.map(st => (
              <StationCard key={st.id} st={st}
                onFav={s => favMut.mutate(s)}
                onEdit={s => { setEditing(s); setShowForm(true) }}
                onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <StationFormDialog
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSave={dto => saveMut.mutate(dto)} />
      )}
      {showDiscover && (
        <DiscoverDialog
          onClose={() => setShowDiscover(false)}
          onAdd={r => {
            saveMut.mutate({ name: r.name, stream_url: r.stream_url, homepage: r.homepage ?? undefined, country: r.country ?? undefined, tags: r.tags })
            setShowDiscover(false)
          }} />
      )}
      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </div>
  )
}
