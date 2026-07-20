import { create } from 'zustand'

export type IdentifyKind = 'movie' | 'show' | 'artist' | 'album'

export interface IdentifyTarget {
  kind: IdentifyKind
  id:   string
  /** Current name/title — pre-fills the search field. */
  name: string
  /** Known year (movies) — pre-fills the year field. */
  year?: number | null
  /** Artist name (albums) — scopes the MusicBrainz search. */
  artist?: string | null
}

interface IdentifyState {
  target: IdentifyTarget | null
  open:  (target: IdentifyTarget) => void
  close: () => void
}

/** Global state for the "Identify" dialog (mounted app-wide). */
export const useIdentifyStore = create<IdentifyState>((set) => ({
  target: null,
  open:  (target) => set({ target }),
  close: () => set({ target: null }),
}))
