import { useMediaVideoStore } from './store/mediaVideoStore'
import FilesVideoFloatingPlayer from './FilesVideoFloatingPlayer'
import type { FileItem } from '@kubuno/drive'
import { mediaApi } from './api'

// Only `id` and `name` are read by the player when srcOverride is provided
const fakeFile = (id: string, name: string) =>
  ({ id, name, size_bytes: 0, mime_type: 'video/mp4' } as unknown as FileItem)

export default function MediaVideoPlayer() {
  const { movieId, title, restorePosition, close, _clearRestorePosition } = useMediaVideoStore()

  if (!movieId) return null

  return (
    <FilesVideoFloatingPlayer
      file={fakeFile(movieId, title)}
      srcOverride={mediaApi.streamUrl(movieId)}
      initialPosition={restorePosition}
      onInitialPositionConsumed={_clearRestorePosition}
      onClose={close}
      onTimeUpdate={(t) => {
        ;(window as Window & { __mediaVideoPos?: number }).__mediaVideoPos = t
      }}
    />
  )
}
