import { create } from 'zustand'

// Bridges the core (shell) SearchBar to the media pages. Each media route
// registers a SearchConfig whose `onSearch` writes here; the active page reads
// `query`. The core SearchBar resets the query (onSearch('')) whenever the
// active config's moduleId changes, so switching tabs clears the search.
interface MediaSearchState {
  query: string
  setQuery: (q: string) => void
}

export const useMediaSearchStore = create<MediaSearchState>((set) => ({
  query: '',
  setQuery: (q) => set({ query: q }),
}))
