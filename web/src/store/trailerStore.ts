import { create } from 'zustand'

interface TrailerState {
  isOpen:     boolean
  title:      string
  year:       number | null
  trailerKey: string | null
  openTrailer: (title: string, year: number | null, trailerKey?: string | null) => void
  close:       () => void
}

export const useTrailerStore = create<TrailerState>((set) => ({
  isOpen:      false,
  title:       '',
  year:        null,
  trailerKey:  null,
  openTrailer: (title, year, trailerKey = null) => set({ isOpen: true, title, year, trailerKey }),
  close:       () => set({ isOpen: false }),
}))
