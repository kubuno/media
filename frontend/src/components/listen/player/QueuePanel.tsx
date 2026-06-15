import { useState } from 'react'
import { GripVertical, X, Trash2, ListMusic } from 'lucide-react'
import { usePlayerStore, type PlayerTrack } from '../../../store/playerStore'
import { formatDuration } from '../../../api'

export const QUEUE_DRAG_TYPE = 'application/kubuno-track'

export function QueuePanel() {
  const { queue, queueIndex, playTrack, removeFromQueue, moveInQueue, clearQueue, addToQueue } =
    usePlayerStore()

  const [dragIndex,    setDragIndex]    = useState<number | null>(null)
  const [dragOverIdx,  setDragOverIdx]  = useState<number | null>(null)
  const [dropTargetOn, setDropTargetOn] = useState(false)

  // ── Row drag-and-drop (reorder) ─────────────────────────────────────────────

  const handleRowDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.setData('application/kubuno-queue-index', String(index))
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  const handleRowDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(index)
    setDropTargetOn(false)
  }

  const handleRowDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    e.stopPropagation()

    // Drop from browse view
    const trackJson = e.dataTransfer.getData(QUEUE_DRAG_TYPE)
    if (trackJson) {
      try { addToQueue(JSON.parse(trackJson) as PlayerTrack) } catch {}
      setDragIndex(null); setDragOverIdx(null)
      return
    }

    // Reorder within queue
    const fromStr = e.dataTransfer.getData('application/kubuno-queue-index')
    const from = Number(fromStr)
    if (!isNaN(from) && from !== targetIndex) moveInQueue(from, targetIndex)
    setDragIndex(null); setDragOverIdx(null)
  }

  // ── Panel-level drop zone (browse → queue) ──────────────────────────────────

  const handlePanelDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(QUEUE_DRAG_TYPE)) {
      e.preventDefault()
      setDropTargetOn(true)
    }
  }

  const handlePanelDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDropTargetOn(false)
    const trackJson = e.dataTransfer.getData(QUEUE_DRAG_TYPE)
    if (trackJson) {
      try { addToQueue(JSON.parse(trackJson) as PlayerTrack) } catch {}
    }
  }

  return (
    <div
      className={`flex flex-col h-full border-l border-border transition-colors ${
        dropTargetOn ? 'bg-primary/5' : ''
      }`}
      style={{ width: 280 }}
      onDragOver={handlePanelDragOver}
      onDragLeave={() => setDropTargetOn(false)}
      onDrop={handlePanelDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <ListMusic size={14} className="text-text-tertiary" />
          <span className="text-sm font-medium text-text-primary">File de lecture</span>
          <span className="text-xs text-text-tertiary">({queue.length})</span>
        </div>
        {queue.length > 1 && (
          <button
            onClick={clearQueue}
            title="Conserver seulement le titre en cours"
            className="p-1 rounded text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto py-1">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <ListMusic size={32} className="text-text-tertiary opacity-30" />
            <p className="text-xs text-text-tertiary leading-relaxed">
              Faites glisser des titres ici ou cliquez sur&nbsp;
              <span className="font-medium text-text-secondary">+</span>
              &nbsp;pour les ajouter à la file
            </p>
          </div>
        ) : (
          queue.map((track, index) => (
            <QueueRow
              key={`${track.id}-${index}`}
              track={track}
              index={index}
              isCurrent={index === queueIndex}
              isDragging={dragIndex === index}
              isDragOver={dragOverIdx === index}
              onPlay={() => playTrack(track, queue, index)}
              onRemove={index !== queueIndex ? () => removeFromQueue(index) : undefined}
              onDragStart={e => handleRowDragStart(e, index)}
              onDragOver={e => handleRowDragOver(e, index)}
              onDrop={e => handleRowDrop(e, index)}
              onDragEnd={() => { setDragIndex(null); setDragOverIdx(null) }}
            />
          ))
        )}
      </div>

      {dropTargetOn && (
        <div className="px-3 py-2 text-xs text-primary text-center border-t border-primary/20 bg-primary/5 flex-shrink-0">
          Déposer pour ajouter à la file
        </div>
      )}
    </div>
  )
}

function QueueRow({
  track, index, isCurrent, isDragging, isDragOver,
  onPlay, onRemove, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  track:      PlayerTrack
  index:      number
  isCurrent:  boolean
  isDragging: boolean
  isDragOver: boolean
  onPlay:     () => void
  onRemove?:  () => void
  onDragStart:(e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop:     (e: React.DragEvent) => void
  onDragEnd:  () => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onPlay}
      className={`
        group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none transition-colors
        ${isCurrent ? 'bg-primary/10' : 'hover:bg-surface-2'}
        ${isDragging ? 'opacity-40' : ''}
        ${isDragOver ? 'border-t-2 border-primary' : ''}
      `}
    >
      <div className="text-text-tertiary opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0">
        <GripVertical size={13} />
      </div>
      <span className={`text-xs flex-shrink-0 w-5 text-right font-mono ${isCurrent ? 'text-primary font-bold' : 'text-text-tertiary'}`}>
        {isCurrent ? '▶' : index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate leading-tight ${isCurrent ? 'text-primary' : 'text-text-primary'}`}>
          {track.title}
        </p>
        {track.artistName && (
          <p className="text-[10px] text-text-tertiary truncate leading-tight">{track.artistName}</p>
        )}
      </div>
      <span className="text-[10px] text-text-tertiary flex-shrink-0 tabular-nums">
        {formatDuration(track.durationSecs)}
      </span>
      {onRemove ? (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
          title="Retirer de la file"
        >
          <X size={11} />
        </button>
      ) : (
        <div className="w-[15px] flex-shrink-0" />
      )}
    </div>
  )
}
