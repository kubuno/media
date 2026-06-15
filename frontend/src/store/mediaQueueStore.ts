import { create } from 'zustand'
import type { Movie } from '../api'

interface QueueEntry {
  id:    string
  title: string
}

interface MediaQueueState {
  queue:      QueueEntry[]
  playNext:   QueueEntry | null
  addToQueue: (movie: Pick<Movie, 'id' | 'title'>) => void
  playNextUp: (movie: Pick<Movie, 'id' | 'title'>) => void
  clear:      () => void
}

export const useMediaQueueStore = create<MediaQueueState>(set => ({
  queue:    [],
  playNext: null,

  addToQueue: (movie) =>
    set(s => ({ queue: [...s.queue, { id: movie.id, title: movie.title }] })),

  playNextUp: (movie) =>
    set({ playNext: { id: movie.id, title: movie.title } }),

  clear: () => set({ queue: [], playNext: null }),
}))
