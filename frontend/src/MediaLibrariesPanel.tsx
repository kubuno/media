import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Library, RefreshCw, Trash2, Plus, Loader2,
  Film, Tv2, Music, Video, CheckCircle2, AlertCircle, Clock,
  Settings, Sparkles, Pencil, Check, FolderOpen, HardDrive,
} from 'lucide-react'
import { mediaApi, type MediaLibrary, type FilesFolderItem } from './api'
import { Dropdown, Checkbox, Button, Tabs, Input } from '@ui'
import { useAuthStore } from '@kubuno/sdk'
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

function FolderSelect({
  folders,
  value,
  onChange,
}: {
  folders: FilesFolderItem[]
  value: string
  onChange: (folder: FilesFolderItem | null) => void
}) {
  const { t } = useTranslation('media')
  // Group by owner
  const byOwner = folders.reduce<Record<string, FilesFolderItem[]>>((acc, f) => {
    const key = f.owner_email
    ;(acc[key] = acc[key] ?? []).push(f)
    return acc
  }, {})

  return (
    <select
      value={value}
      onChange={e => {
        const folder = folders.find(f => f.id === e.target.value) ?? null
        onChange(folder)
      }}
      className="w-full px-3 py-1.5 text-sm rounded-lg border border-border bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
    >
      <option value="">{t('media_select_folder_placeholder')}</option>
      {Object.entries(byOwner).map(([email, flds]) => (
        <optgroup key={email} label={email}>
          {flds.map(f => (
            <option key={f.id} value={f.id}>
              {f.path || '/'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function AddLibraryForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const { t } = useTranslation('media')
  const qc = useQueryClient()
  const [name,       setName]       = useState('')
  const [libType,    setLibType]    = useState('movies')
  const [sourceType, setSourceType] = useState<'filesystem' | 'files_folder'>('filesystem')
  const [path,       setPath]       = useState('')
  const [isShared,   setIsShared]   = useState(true)
  const [selectedFolder, setSelectedFolder] = useState<FilesFolderItem | null>(null)

  const { data: filesFolders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ['media', 'files-folders'],
    queryFn:  mediaApi.getFilesFolders,
    enabled:  sourceType === 'files_folder',
  })

  const canSubmit = name.trim() && (
    sourceType === 'filesystem' ? path.trim() : !!selectedFolder
  )

  const mutation = useMutation({
    mutationFn: () => mediaApi.createLibrary(
      sourceType === 'files_folder' && selectedFolder
        ? { name, lib_type: libType, is_shared: isShared, source_type: 'files_folder',
            files_folder_id: selectedFolder.id, files_owner_id: selectedFolder.owner_id }
        : { name, lib_type: libType, path, is_shared: isShared, source_type: 'filesystem' }
    ),
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

        {/* Source */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('media_field_source')}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSourceType('filesystem')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                sourceType === 'filesystem'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-text-secondary hover:bg-surface-2'
              }`}
            >
              <HardDrive size={14} /> {t('media_source_server_path')}
            </button>
            <button
              type="button"
              onClick={() => setSourceType('files_folder')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                sourceType === 'files_folder'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-text-secondary hover:bg-surface-2'
              }`}
            >
              <FolderOpen size={14} /> {t('media_source_files_folder')}
            </button>
          </div>
        </div>

        {/* Path ou dossier Files */}
        {sourceType === 'filesystem' ? (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('media_field_server_path')}</label>
            <Input
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder="/var/lib/kubuno/modules/media/files/movies"
              className="font-mono"
            />
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('media_field_files_folder')}
            </label>
            {foldersLoading ? (
              <div className="flex items-center gap-2 text-sm text-text-secondary py-1.5">
                <Loader2 size={14} className="animate-spin" /> {t('media_loading_folders')}
              </div>
            ) : filesFolders.length === 0 ? (
              <p className="text-xs text-text-tertiary py-1">{t('media_no_folders')}</p>
            ) : (
              <FolderSelect
                folders={filesFolders}
                value={selectedFolder?.id ?? ''}
                onChange={setSelectedFolder}
              />
            )}
            {selectedFolder && (
              <p className="text-xs text-text-tertiary mt-1">
                {selectedFolder.owner_email} · {selectedFolder.path || '/'}
              </p>
            )}
          </div>
        )}

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

// ── Library row ───────────────────────────────────────────────────────────────

function LibraryRow({ lib, isAdmin }: { lib: MediaLibrary; isAdmin: boolean }) {
  const { t, i18n } = useTranslation('media')
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
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
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white w-full max-w-md h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Library size={18} className="text-primary" />
            <h2 className="text-base font-semibold text-text-primary">{t('media_panel_title')}</h2>
            {hasScanning && tab === 'libraries' && <Loader2 size={14} className="animate-spin text-primary" />}
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && tab === 'libraries' && (
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
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors ml-1">
              <X size={18} />
            </button>
          </div>
        </div>

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
    </div>
  )
}
