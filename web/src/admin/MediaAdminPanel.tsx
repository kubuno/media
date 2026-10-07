// Instance administration of media, rendered in the core admin console under
// Modules ▸ Media (slot `module-admin:media`). The metadata provider keys are
// SECRETS (TMDB / OMDb) kept in the module's own `media.settings` table and read
// through the guarded `/media/admin/settings` endpoints; they never belonged on
// a user's own settings page, where they used to sit. Registered as a custom
// section (not a generic form) because the values are secrets, not scalars.

import React, { useEffect, useState } from 'react'
import { Check, Globe2, KeyRound } from 'lucide-react'
import { Button } from '@ui'
import { ModuleAdminRegistry } from '@kubuno/sdk'
import { mediaApi } from '../api'

const METADATA_LANGUAGES = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'it', label: 'Italiano' },
  { id: 'pt', label: 'Português' },
]

function SettingsRow({ label, description, children }: {
  label: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-8 py-4 border-b border-border last:border-0">
      <div className="w-60 flex-shrink-0">
        <p className="text-sm text-text-primary font-normal">{label}</p>
        {description && <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function MetadataSection() {
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
          className="text-sm border border-border rounded-lg px-2.5 py-1.5 bg-surface-0 text-text-primary"
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
            className="text-sm border border-border rounded-lg px-2.5 py-1.5 w-64 bg-surface-0 text-text-primary placeholder:text-text-tertiary"
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
            className="text-sm border border-border rounded-lg px-2.5 py-1.5 w-64 bg-surface-0 text-text-primary placeholder:text-text-tertiary"
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

// Registers the media admin sections into the core console.
export function registerMediaAdmin() {
  ModuleAdminRegistry.register({
    moduleId:  'media',
    id:        'metadata',
    group:     'metadata',
    position:  10,
    Component: MetadataSection,
  })
}
