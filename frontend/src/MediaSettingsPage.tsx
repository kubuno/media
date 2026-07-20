import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Music, ArrowLeft, ExternalLink, Check, KeyRound, Globe2 } from 'lucide-react'
import { Toggle, Button, Radio } from '@ui'
import { useModulePrefs } from './userPrefs'
import { mediaApi } from './api'

// ── Per-user preferences (backend, cross-device via core users.preferences) ─────

// Type alias (not interface): gets an implicit index signature, required by
// useModulePrefs<T extends Record<string, unknown>>.
type MediaPrefs = {
  defaultVolume:    string   // '25' | '50' | '75' | '100'
  autoplayNext:     boolean  // play the next track/episode automatically
  normalizeVolume:  boolean  // loudness normalization across tracks
  streamQuality:    string   // 'auto' | 'low' | 'high' | 'lossless'
  crossfadeDefault: boolean  // crossfade between tracks enabled by default
  equalizerDefault: boolean  // equalizer enabled by default
  playerTheme:      string   // 'dark' | 'light' | 'auto'
}

const DEFAULT_PREFS: MediaPrefs = {
  defaultVolume: '75', autoplayNext: true, normalizeVolume: false,
  streamQuality: 'auto', crossfadeDefault: false, equalizerDefault: false,
  playerTheme: 'dark',
}

// ── Mail-style layout helpers ───────────────────────────────────────────────────

function SettingsRow({ label, description, children }: {
  label: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-8 py-4 border-b border-[#e8eaed] last:border-0">
      <div className="w-60 flex-shrink-0">
        <p className="text-sm text-[#202124] font-normal">{label}</p>
        {description && <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function RadioGroup({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      {options.map(opt => (
        <Radio key={opt.value} checked={value === opt.value} onChange={() => onChange(opt.value)} label={opt.label} />
      ))}
    </div>
  )
}

// ── Preferences tab (per-user) ──────────────────────────────────────────────────

function PreferencesTab() {
  const { t } = useTranslation('media')
  const { prefs: saved, update } = useModulePrefs<MediaPrefs>('media', DEFAULT_PREFS)
  const [prefs, setPrefs] = useState<MediaPrefs>(saved)
  const [savedFlag, setSavedFlag] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof MediaPrefs>(key: K, value: MediaPrefs[K]) =>
    setPrefs(p => ({ ...p, [key]: value }))

  const save = async () => {
    setBusy(true)
    try {
      await update(prefs)
      setSavedFlag(true)
      setTimeout(() => setSavedFlag(false), 2500)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <SettingsRow
        label={t('media_pref_volume', { defaultValue: 'Volume par défaut' })}
        description={t('media_pref_volume_desc', { defaultValue: 'Niveau sonore appliqué à l\'ouverture du lecteur.' })}
      >
        <RadioGroup
          value={prefs.defaultVolume}
          onChange={v => set('defaultVolume', v)}
          options={[
            { value: '25',  label: '25 %' },
            { value: '50',  label: '50 %' },
            { value: '75',  label: '75 %' },
            { value: '100', label: '100 %' },
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('media_pref_quality', { defaultValue: 'Qualité de streaming' })}
        description={t('media_pref_quality_desc', { defaultValue: 'Qualité audio/vidéo demandée pour la lecture en continu.' })}
      >
        <RadioGroup
          value={prefs.streamQuality}
          onChange={v => set('streamQuality', v)}
          options={[
            { value: 'auto',     label: t('media_pref_quality_auto',     { defaultValue: 'Automatique (selon la connexion)' }) },
            { value: 'low',      label: t('media_pref_quality_low',      { defaultValue: 'Économique (données réduites)' }) },
            { value: 'high',     label: t('media_pref_quality_high',     { defaultValue: 'Élevée' }) },
            { value: 'lossless', label: t('media_pref_quality_lossless', { defaultValue: 'Sans perte (si disponible)' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('media_pref_player_theme', { defaultValue: 'Thème du lecteur' })}
        description={t('media_pref_player_theme_desc', { defaultValue: 'Apparence des lecteurs audio et vidéo.' })}
      >
        <RadioGroup
          value={prefs.playerTheme}
          onChange={v => set('playerTheme', v)}
          options={[
            { value: 'dark',  label: t('media_pref_theme_dark',  { defaultValue: 'Sombre' }) },
            { value: 'light', label: t('media_pref_theme_light', { defaultValue: 'Clair' }) },
            { value: 'auto',  label: t('media_pref_theme_auto',  { defaultValue: 'Automatique (système)' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('media_pref_autoplay', { defaultValue: 'Lecture automatique' })}
        description={t('media_pref_autoplay_desc', { defaultValue: 'Enchaîner automatiquement le morceau ou l\'épisode suivant.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.autoplayNext} onChange={() => set('autoplayNext', !prefs.autoplayNext)} />
          <span className="text-sm text-text-primary">{t('media_pref_autoplay_on', { defaultValue: 'Lire automatiquement le suivant' })}</span>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t('media_pref_normalize', { defaultValue: 'Normalisation du volume' })}
        description={t('media_pref_normalize_desc', { defaultValue: 'Harmoniser le niveau sonore entre les morceaux.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.normalizeVolume} onChange={() => set('normalizeVolume', !prefs.normalizeVolume)} />
          <span className="text-sm text-text-primary">{t('media_pref_normalize_on', { defaultValue: 'Activer la normalisation du volume' })}</span>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t('media_pref_crossfade', { defaultValue: 'Fondu enchaîné' })}
        description={t('media_pref_crossfade_desc', { defaultValue: 'Traverser en fondu (crossfade) entre deux morceaux.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.crossfadeDefault} onChange={() => set('crossfadeDefault', !prefs.crossfadeDefault)} />
          <span className="text-sm text-text-primary">{t('media_pref_crossfade_on', { defaultValue: 'Activer le fondu enchaîné par défaut' })}</span>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t('media_pref_equalizer', { defaultValue: 'Égaliseur' })}
        description={t('media_pref_equalizer_desc', { defaultValue: 'Activer l\'égaliseur audio par défaut.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.equalizerDefault} onChange={() => set('equalizerDefault', !prefs.equalizerDefault)} />
          <span className="text-sm text-text-primary">{t('media_pref_equalizer_on', { defaultValue: 'Activer l\'égaliseur par défaut' })}</span>
        </label>
      </SettingsRow>

      <div className="pt-5 flex items-center gap-3">
        <Button onClick={save} loading={busy}>
          {savedFlag
            ? <><Check size={14} className="mr-1.5 inline" />{t('media_settings_saved', { defaultValue: 'Enregistré' })}</>
            : t('media_settings_save_changes', { defaultValue: 'Enregistrer les modifications' })}
        </Button>
        <Button variant="ghost" onClick={() => setPrefs(saved)}>
          {t('common_cancel', { defaultValue: 'Annuler' })}
        </Button>
      </div>
    </div>
  )
}

// ── About tab ────────────────────────────────────────────────────────────────

// ── Metadata providers tab (admin) ──────────────────────────────────────────────

const METADATA_LANGUAGES = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'it', label: 'Italiano' },
  { id: 'pt', label: 'Português' },
]

function MetadataTab() {
  const [language, setLanguage]   = useState('fr')
  const [tmdbKey, setTmdbKey]     = useState('')
  const [omdbKey, setOmdbKey]     = useState('')
  const [loaded, setLoaded]       = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [savedFlag, setSavedFlag] = useState(false)

  useEffect(() => {
    mediaApi.getAdminSettings()
      .then(s => {
        if (s.metadata_language) setLanguage(s.metadata_language)
        if (s.tmdb_api_key) setTmdbKey(s.tmdb_api_key)
        if (s.omdb_api_key) setOmdbKey(s.omdb_api_key)
        setLoaded(true)
      })
      .catch(() => setForbidden(true))
  }, [])

  async function save() {
    setSaving(true)
    try {
      await mediaApi.patchAdminSettings({
        metadata_language: language,
        tmdb_api_key: tmdbKey.trim(),
        omdb_api_key: omdbKey.trim(),
      })
      setSavedFlag(true)
      setTimeout(() => setSavedFlag(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  if (forbidden) {
    return (
      <div className="rounded-xl border border-border px-5 py-6 text-sm text-text-tertiary">
        Réservé aux administrateurs.
      </div>
    )
  }
  if (!loaded) return null

  return (
    <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
      <SettingsRow
        label="Langue des métadonnées"
        description="Langue des résumés, genres et titres récupérés sur internet."
      >
        <select
          value={language}
          onChange={e => setLanguage(e.target.value)}
          className="text-sm border border-border rounded-lg px-2.5 py-1.5 bg-white text-text-primary"
        >
          {METADATA_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </SettingsRow>
      <SettingsRow
        label="Clé API TMDB"
        description="Fournisseur principal films/séries : distribution avec photos, bandes-annonces, classifications, textes localisés. Clé v3 ou jeton v4 — gratuite sur themoviedb.org/settings/api. Vide = repli sans clé (Wikipédia + recherche publique TMDB)."
      >
        <div className="flex items-center gap-2">
          <KeyRound size={14} className="text-text-tertiary" />
          <input
            type="password"
            value={tmdbKey}
            onChange={e => setTmdbKey(e.target.value)}
            placeholder="Clé API…"
            autoComplete="off"
            className="text-sm border border-border rounded-lg px-2.5 py-1.5 w-64 bg-white text-text-primary placeholder:text-text-tertiary"
          />
        </div>
      </SettingsRow>
      <SettingsRow
        label="Clé API OMDb"
        description="Notes Rotten Tomatoes, IMDb et Metacritic (+ affiches IMDb en secours) sur les fiches films/séries. Clé gratuite sur omdbapi.com/apikey.aspx (1000 requêtes/jour)."
      >
        <div className="flex items-center gap-2">
          <KeyRound size={14} className="text-text-tertiary" />
          <input
            type="password"
            value={omdbKey}
            onChange={e => setOmdbKey(e.target.value)}
            placeholder="Clé API…"
            autoComplete="off"
            className="text-sm border border-border rounded-lg px-2.5 py-1.5 w-64 bg-white text-text-primary placeholder:text-text-tertiary"
          />
        </div>
      </SettingsRow>
      <div className="px-5 py-3 flex items-center gap-3 bg-surface-1">
        <Button size="sm" onClick={() => { void save() }} disabled={saving}
          icon={savedFlag ? <Check size={14} /> : <Globe2 size={14} />}>
          {savedFlag ? 'Enregistré' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  )
}

function AboutTab() {
  const { t } = useTranslation('media')
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-surface-1">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
          <Music size={20} className="text-blue-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">Kubuno Media</p>
          <p className="text-xs text-text-tertiary">v0.1.0 · {t('media_official_module', { defaultValue: 'Module officiel' })}</p>
        </div>
        <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Rust</span>
      </div>
      <div className="px-5 py-4">
        <a href="https://github.com/kubuno/kubuno" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ExternalLink size={13} /> github.com/kubuno/kubuno
        </a>
      </div>
    </div>
  )
}

// ── Main page (mail-style breadcrumb + tab bar) ─────────────────────────────────

type Tab = 'preferences' | 'metadata' | 'about'

export default function MediaSettingsPage() {
  const { t } = useTranslation('media')
  const [tab, setTab] = useState<Tab>('preferences')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'preferences', label: t('media_tab_preferences', { defaultValue: 'Préférences' }) },
    { id: 'metadata',    label: t('media_tab_metadata', { defaultValue: 'Métadonnées' }) },
    { id: 'about',       label: t('media_tab_about', { defaultValue: 'À propos' }) },
  ]

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[#e8eaed] flex-shrink-0" style={{ background: '#f8f9fa' }}>
        <Link to="/media/listen" className="flex items-center gap-1.5 text-sm text-[#1a73e8] hover:underline">
          <ArrowLeft size={14} />
          Media
        </Link>
        <span className="text-text-tertiary text-sm">/</span>
        <div className="flex items-center gap-1.5">
          <Music size={15} className="text-text-secondary" />
          <span className="text-sm text-text-primary">{t('media_settings_title', { defaultValue: 'Réglages' })}</span>
        </div>
      </div>

      {/* Tab bar (Gmail-style) */}
      <div className="flex items-end border-b border-[#e8eaed] px-4 flex-shrink-0 overflow-x-auto" style={{ background: '#fff' }}>
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-4 py-3 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === tb.id ? 'border-[#1a73e8] text-[#1a73e8] font-medium' : 'border-transparent text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4]'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-6">
          {tab === 'preferences' && <PreferencesTab />}
          {tab === 'metadata'    && <MetadataTab />}
          {tab === 'about'       && <AboutTab />}
        </div>
      </div>
    </div>
  )
}
