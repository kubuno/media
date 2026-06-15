import { create } from 'zustand'

interface MediaVideoState {
  movieId:         string | null
  title:           string
  restorePosition: number
  open:    (id: string, title: string) => void
  close:   () => void
  _clearRestorePosition: () => void
}

const SESSION_KEY = 'kubuno:media:video'

type Snapshot = { movieId: string; title: string; position: number }

function loadSnapshot(): Snapshot | null {
  try {
    const s = sessionStorage.getItem(SESSION_KEY)
    return s ? (JSON.parse(s) as Snapshot) : null
  } catch { return null }
}

const _snap = loadSnapshot()

export const useMediaVideoStore = create<MediaVideoState>((set, get) => {
  window.addEventListener('beforeunload', () => {
    const st = get()
    if (st.movieId) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          movieId:  st.movieId,
          title:    st.title,
          position: (window as Window & { __mediaVideoPos?: number }).__mediaVideoPos ?? 0,
        }))
      } catch {}
    } else {
      try { sessionStorage.removeItem(SESSION_KEY) } catch {}
    }
  })

  return {
    movieId:         _snap?.movieId ?? null,
    title:           _snap?.title   ?? '',
    restorePosition: _snap?.position ?? 0,

    open: (movieId, title) => set({ movieId, title, restorePosition: 0 }),
    close: () => {
      try { sessionStorage.removeItem(SESSION_KEY) } catch {}
      set({ movieId: null, title: '', restorePosition: 0 })
    },
    _clearRestorePosition: () => set({ restorePosition: 0 }),
  }
})
