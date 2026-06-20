import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Library, RefreshCw, Trash2, Plus, Loader2, X, Users,
  Film, Tv2, Music, Video, CheckCircle2, AlertCircle, Clock,
  Settings, Sparkles, Pencil, Check, FolderOpen, HardDrive,
} from 'lucide-react'
import { mediaApi, type MediaLibrary, type UserSummary } from './api'
import { Dropdown, Checkbox, Button, Tabs, Input, FloatingWindow } from '@ui'
import { useAuthStore } from '@kubuno/sdk'
import { useFilesDialogStore, type FolderSelection } from '@kubuno/drive'
import { useConfirm } from '@kubuno/sdk'
import { ConfirmDialog } from '@ui'

// ── Helpers ───────────────────────────────────────────────────────────────────

const LIB_TYPES = [
  { value: 'movies',      labelKey: 'media_libtype_movies',      icon: Film  },
  { value: 'shows',       labelKey: 'media_libtype_shows',       icon: Tv2   },
  { value: 'music',       labelKey: 'media_libtype_music',       icon: Music },
  { value: 'home_videos', labelKey: 'media_libtype_home_videos', icon: Video },
]

function libTypeLabel(t: TFunction, type: string) {
  const entry = LIB_TYPES.find(l => l.value === type)
  return entry ? t(entry.labelKey) : type
}

function LibIcon({ type }: { type: string }) {
  const entry = LIB_TYPES.find(l => l.value === type)
  const Icon  = entry?.icon ?? Library
  return <Icon size={16} />
}

function ScanBadge({ status }: { status: string }) {
  const { t } = useTranslation('media')
  if (status === 'scanning') {
    return (
      <span className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
        <Loader2 size={11} className="animate-spin" /> {t('media_scan_in_progress')}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-danger bg-danger/10 px-2 py-0.5 rounded-full">
        <AlertCircle size={11} /> {t('media_scan_error')}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-0.5 rounded-full">
      <CheckCircle2 size={11} /> {t('media_scan_ready')}
    </span>
  )
}

function formatDate(iso: string | null, neverLabel: string, lang: string) {
  if (!iso) return neverLabel
  return new Date(iso).toLocaleString(lang, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Add library form ──────────────────────────────────────────────────────────

function AddLibraryForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const { t } = useTranslation('media')
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [name,     setName]     = useState('')
  const [libType,  setLibType]  = useState('movies')
  const [isShared, setIsShared] = useState(true)
  const [folder,   setFolder]   = useState<FolderSelection | null>(null)

  const pickFolder = async () => {
    const sel = await useFilesDialogStore.getState().pickFolder({ title: t('media_pick_folder_title') })
    if (sel) setFolder(sel)
  }

  const canSubmit = !!name.trim() && !!folder && folder.id != null

  const mutation = useMutation({
    mutationFn: () => mediaApi.createLibrary({
      name, lib_type: libType, is_shared: isShared, source_type: 'files_folder',
      files_folder_id: folder?.id ?? undefined,
      files_owner_id:  user?.id ?? undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', 'libraries'] })
      onSaved()
    },
  })

  return (
    <div className="bg-surface-1 rounded-xl border border-border p-4 mt-2">
      <h3 className="text-sm font-semibold text-text-primary mb-3">{t('media_new_library')}</h3>
      <div className="space-y-3">
        {/* Nom */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('media_field_name')}</label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('media_name_placeholder')}
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('media_field_type')}</label>
          <Dropdown
            className="w-full"
            value={libType}
            onChange={v => setLibType(v)}
            options={LIB_TYPES.map(lt => ({ value: lt.value, label: t(lt.labelKey) }))}
          />
        </div>

        {/* Dossier — ouvre le navigateur de fichiers du drive */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('media_field_files_folder')}</label>
          <button
            type="button"
            onClick={pickFolder}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-left text-text-secondary hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <FolderOpen size={15} className="text-primary flex-shrink-0" />
            <span className={`flex-1 truncate ${folder ? 'text-text-primary' : 'text-text-tertiary'}`}>
              {folder ? folder.name : t('media_pick_folder_cta')}
            </span>
          </button>
        </div>

        <Checkbox
          label={t('media_shared_with_all')}
          checked={isShared}
          onChange={v => setIsShared(v)}
        />

        {mutation.isError && (
          <p className="text-xs text-danger">
            {(mutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('media_error')}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="secondary" onClick={onCancel}>{t('common_cancel')}</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit} loading={mutation.isPending}>
            {t('common_create')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Share dialog ──────────────────────────────────────────────────────────────

function LibraryShareDialog({ lib, onClose }: { lib: MediaLibrary; onClose: () => void }) {
  const { t } = useTranslation('media')
  const qc = useQueryClient()
  const [selected, setSelected] = useState<UserSummary[]>([])
  const [search, setSearch] = useState('')

  // Resolve the currently-shared users (ids → names).
  const { data: current } = useQuery({
    queryKey: ['media', 'lib-shares', lib.id],
    queryFn:  () => mediaApi.lookupUsers(lib.shared_user_ids ?? []),
  })
  useEffect(() => { if (current) setSelected(current) }, [current])

  const { data: results = [] } = useQuery({
    queryKey: ['media', 'user-search', search],
    queryFn:  () => mediaApi.searchUsers(search.trim()),
    enabled:  search.trim().length > 0,
  })

  const add    = (u: UserSummary) => setSelected(s => s.some(x => x.id === u.id) ? s : [...s, u])
  const remove = (id: string)     => setSelected(s => s.filter(x => x.id !== id))

  const save = useMutation({
    mutationFn: () => mediaApi.setLibraryShares(lib.id, selected.map(u => u.id)),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['media', 'libraries'] }); onClose() },
  })

  return (
    <FloatingWindow
      title={t('media_share_title', { name: lib.name })}
      icon={<Users size={16} className="text-primary" />}
      onClose={onClose}
      defaultWidth={460} defaultHeight={520} minWidth={360} minHeight={380} resizable
    >
      <div className="flex flex-col h-full bg-white p-4 gap-3">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('media_share_search_users')} />

        {search.trim() && (
          <div className="border border-border rounded-lg max-h-40 overflow-y-auto flex-shrink-0">
            {results.length === 0 ? (
              <p className="text-xs text-text-tertiary p-2">{t('media_share_no_users')}</p>
            ) : results.map(u => (
              <button key={u.id} onClick={() => add(u)}
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-surface-1 text-left text-sm">
                <span className="flex-1 truncate">{u.display_name} <span className="text-text-tertiary">@{u.username}</span></span>
                {selected.some(x => x.id === u.id) ? <Check size={14} className="text-success" /> : <Plus size={14} className="text-primary" />}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          <p className="text-xs font-medium text-text-secondary mb-2">{t('media_share_shared_with')} ({selected.length})</p>
          {selected.length === 0 ? (
            <p className="text-xs text-text-tertiary">{t('media_share_none')}</p>
          ) : (
            <div className="space-y-1">
              {selected.map(u => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-1">
                  <span className="flex-1 truncate text-sm">{u.display_name} <span className="text-text-tertiary">@{u.username}</span></span>
                  <button onClick={() => remove(u.id)} className="text-text-tertiary hover:text-danger transition-colors"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1 flex-shrink-0">
          <Button variant="secondary" size="sm" onClick={onClose}>{t('common_cancel')}</Button>
          <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>{t('common_save')}</Button>
        </div>
      </div>
    </FloatingWindow>
  )
}

// ── Library row ───────────────────────────────────────────────────────────────

function LibraryRow({ lib, isAdmin }: { lib: MediaLibrary; isAdmin: boolean }) {
  const { t, i18n } = useTranslation('media')
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [editName, setEditName] = useState(lib.name)
  const [editPath, setEditPath] = useState(lib.path)
  const [editShared, setEditShared] = useState(lib.is_shared ?? true)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const scanMutation = useMutation({
    mutationFn: () => mediaApi.scanLibrary(lib.id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['media', 'libraries'] }),
  })

  const updateMutation = useMutation({
    mutationFn: () => mediaApi.updateLibrary(lib.id, { name: editName, path: editPath, is_shared: editShared }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['media', 'libraries'] })
      setEditing(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => mediaApi.deleteLibrary(lib.id),
    onSuccess: () => {
      // Invalidate all media content so deleted items disappear immediately
      qc.invalidateQueries({ queryKey: ['media', 'libraries'] })
      qc.invalidateQueries({ queryKey: ['media', 'movies'] })
      qc.invalidateQueries({ queryKey: ['media', 'shows'] })
      qc.invalidateQueries({ queryKey: ['media', 'artists'] })
      qc.invalidateQueries({ queryKey: ['media', 'albums'] })
      qc.invalidateQueries({ queryKey: ['media', 'tracks'] })
    },
  })

  const handleDelete = async () => {
    const ok = await confirm({
      title:        t('media_delete_library_title', { name: lib.name }),
      message:      t('media_delete_library_message'),
      confirmLabel: t('common_delete'),
      cancelLabel:  t('common_cancel'),
      variant:      'danger',
    })
    if (ok) deleteMutation.mutate()
  }

  const isScanning = lib.scan_status === 'scanning' || scanMutation.isPending

  function startEdit() {
    setEditName(lib.name)
    setEditPath(lib.path)
    setEditShared(lib.is_shared ?? true)
    setEditing(true)
  }

  if (editing) {
    return (
      <div className="p-3 rounded-xl border border-primary/40 bg-primary/5">
        <div className="space-y-2">
          <Input
            value={editName}
            onChange={e => setEditName(e.target.value)}
            placeholder={t('media_field_name')}
          />
          <Input
            value={editPath}
            onChange={e => setEditPath(e.target.value)}
            placeholder={t('media_field_server_path')}
            className="font-mono"
          />
          <Checkbox
            label={t('media_shared_with_all')}
            checked={editShared}
            onChange={v => setEditShared(v)}
          />
          {updateMutation.isError && (
            <p className="text-xs text-danger">
              {(updateMutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('media_error')}
            </p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>{t('common_cancel')}</Button>
            <Button
              size="sm"
              icon={<Check size={13} />}
              onClick={() => updateMutation.mutate()}
              disabled={!editName.trim() || !editPath.trim()}
              loading={updateMutation.isPending}
            >
              {t('common_save')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border bg-white hover:bg-surface-1 transition-colors">
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary flex-shrink-0 mt-0.5">
        <LibIcon type={lib.lib_type} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary">{lib.name}</span>
          <span className="text-xs text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded-md">
            {libTypeLabel(t, lib.lib_type)}
          </span>
          <ScanBadge status={lib.scan_status} />
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {lib.source_type === 'files_folder'
            ? <FolderOpen size={11} className="text-primary flex-shrink-0" />
            : <HardDrive size={11} className="text-text-tertiary flex-shrink-0" />
          }
          <p className="text-xs text-text-tertiary font-mono truncate" title={lib.path}>
            {lib.path}
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
          <span className="flex items-center gap-1">
            <Library size={11} />
            {t('media_item_count', { count: lib.item_count })}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {formatDate(lib.last_scan_at, t('media_never'), i18n.language)}
          </span>
        </div>
      </div>

      {/* Actions */}
      {isAdmin && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => scanMutation.mutate()}
            disabled={isScanning}
            title={t('media_action_rescan')}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={isScanning ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShareOpen(true)}
            title={t('media_share_action')}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-primary transition-colors"
          >
            <Users size={15} />
          </button>
          <button
            onClick={startEdit}
            title={t('common_edit')}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-primary transition-colors"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            title={t('common_delete')}
            className="p-1.5 rounded-lg hover:bg-danger/10 text-text-secondary hover:text-danger transition-colors disabled:opacity-50"
          >
            {deleteMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
          {confirmState && (
            <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
          )}
        </div>
      )}
      {shareOpen && <LibraryShareDialog lib={lib} onClose={() => setShareOpen(false)} />}
    </div>
  )
}

// ── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const { t } = useTranslation('media')
  const qc = useQueryClient()
  const [lang,      setLang]      = useState('')
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null)

  const { data: settings } = useQuery({
    queryKey: ['media', 'admin', 'settings'],
    queryFn:  mediaApi.getAdminSettings,
  })

  const saveMutation = useMutation({
    mutationFn: () => mediaApi.patchAdminSettings({ metadata_language: lang }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['media', 'admin', 'settings'] }),
  })

  const enrichMutation = useMutation({
    mutationFn: mediaApi.triggerEnrich,
    onSuccess: (data) => {
      setEnrichMsg(data.message)
      setTimeout(() => setEnrichMsg(null), 5000)
    },
  })

  return (
    <div className="px-5 py-4 space-y-6">
      {/* Sources de métadonnées */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Settings size={15} className="text-text-secondary" />
          {t('media_metadata_sources')}
        </h3>

        <div className="p-3 rounded-xl bg-surface-1 border border-border mb-4 space-y-1">
          <p className="text-xs text-text-secondary flex items-center gap-1.5">
            <span className="text-success">✓</span>
            <span><strong>{t('media_source_movies_label')}</strong> {t('media_source_movies_value')}</span>
          </p>
          <p className="text-xs text-text-secondary flex items-center gap-1.5">
            <span className="text-success">✓</span>
            <span><strong>{t('media_source_shows_label')}</strong> {t('media_source_shows_value')}</span>
          </p>
          <p className="text-xs text-text-secondary flex items-center gap-1.5">
            <span className="text-success">✓</span>
            <span><strong>{t('media_source_music_label')}</strong> {t('media_source_music_value')}</span>
          </p>
        </div>

        <label className="block text-xs font-medium text-text-secondary mb-1">
          {t('media_metadata_language')}
        </label>
        <Input
          type="text"
          value={lang || settings?.metadata_language || ''}
          onChange={e => setLang(e.target.value)}
          placeholder="fr-FR"
        />
        <p className="text-xs text-text-tertiary mt-1">
          {t('media_metadata_language_hint')}
        </p>

        <Button className="mt-3" onClick={() => saveMutation.mutate()} disabled={!lang} loading={saveMutation.isPending}>
          {t('common_save')}
        </Button>
        {saveMutation.isSuccess && (
          <p className="text-xs text-success mt-2">✓ {t('media_language_saved')}</p>
        )}
      </div>

      {/* Enrichissement metadata */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Sparkles size={15} className="text-text-secondary" />
          {t('media_metadata_enrich')}
        </h3>
        <p className="text-xs text-text-secondary mb-3">
          {t('media_metadata_enrich_desc')}
        </p>
        <Button
          variant="secondary"
          icon={<RefreshCw size={14} />}
          onClick={() => enrichMutation.mutate()}
          loading={enrichMutation.isPending}
        >
          {t('media_relaunch_enrich')}
        </Button>
        {enrichMsg && (
          <p className="text-xs text-success mt-2">✓ {enrichMsg}</p>
        )}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  open:    boolean
  onClose: () => void
}

export default function MediaLibrariesPanel({ open, onClose }: Props) {
  const { t }   = useTranslation('media')
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const qc      = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [tab, setTab] = useState<'libraries' | 'settings'>('libraries')

  const { data: libraries = [], isLoading } = useQuery({
    queryKey: ['media', 'libraries'],
    queryFn:  mediaApi.getLibraries,
    enabled:  open,
    refetchInterval: open ? 5000 : false,  // poll pendant que le panel est ouvert
  })

  const scanAllMutation = useMutation({
    mutationFn: mediaApi.scanAllLibraries,
    onSuccess:  () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['media', 'libraries'] }), 500)
    },
  })

  if (!open) return null

  const hasScanning = libraries.some(l => l.scan_status === 'scanning')

  return (
    <FloatingWindow
      title={t('media_panel_title')}
      icon={<Library size={16} className="text-primary" />}
      onClose={onClose}
      defaultWidth={540}
      defaultHeight={640}
      minWidth={380}
      minHeight={420}
      resizable
      titleActions={isAdmin && tab === 'libraries' ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={13} className={scanAllMutation.isPending ? 'animate-spin' : ''} />}
          onClick={() => scanAllMutation.mutate()}
          disabled={scanAllMutation.isPending || hasScanning}
          title={t('media_rescan_all')}
        >
          {t('media_rescan_all')}
        </Button>
      ) : undefined}
    >
      <div className="flex flex-col h-full bg-white">
        {/* Tab bar */}
        <Tabs
          tabs={[
            { id: 'libraries', label: t('media_tab_libraries'), icon: Library },
            ...(isAdmin ? [{ id: 'settings' as const, label: t('media_tab_settings'), icon: Settings }] : []),
          ]}
          value={tab}
          onChange={setTab}
          variant="stretched"
          size="sm"
          className="flex-shrink-0"
        />

        {/* Body */}
        {tab === 'settings' ? (
          <div className="flex-1 overflow-y-auto">
            <SettingsTab />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            ) : libraries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Library size={40} className="text-text-tertiary mb-3" />
                <p className="text-sm font-medium text-text-primary">{t('media_empty_title')}</p>
                <p className="text-xs text-text-secondary mt-1">{t('media_empty_desc')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {libraries.map(lib => (
                  <LibraryRow key={lib.id} lib={lib} isAdmin={isAdmin} />
                ))}
              </div>
            )}

            {/* Add form */}
            {isAdmin && (
              showAdd
                ? <AddLibraryForm onCancel={() => setShowAdd(false)} onSaved={() => setShowAdd(false)} />
                : (
                  <button
                    onClick={() => setShowAdd(true)}
                    className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border text-sm text-text-secondary hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <Plus size={16} /> {t('media_add_library')}
                  </button>
                )
            )}
          </div>
        )}
      </div>
    </FloatingWindow>
  )
}
