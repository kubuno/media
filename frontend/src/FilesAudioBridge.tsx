import { useEffect } from 'react'
import { useFilesMediaPlayerStore } from '@kubuno/drive'
import { usePlayerStore } from './store/playerStore'

/**
 * Composant null monté via app-dialogs quand le module media est actif.
 * Il intercepte tout fichier audio ouvert depuis le module files et le
 * redirige vers le lecteur audio du module media (plus riche).
 */
export default function FilesAudioBridge() {
  const file      = useFilesMediaPlayerStore(s => s.file)
  const filesClose = useFilesMediaPlayerStore(s => s.close)
  const playTrack = usePlayerStore(s => s.playTrack)

  useEffect(() => {
    if (!file) return
    // Redirige vers le media player en utilisant l'URL de téléchargement files
    playTrack({
      id:          file.id,
      title:       file.name.replace(/\.[^.]+$/, ''), // enlève l'extension
      durationSecs: 0,
      streamUrl:   `/api/v1/drive/${file.id}/download`,
    })
    // Ferme le lecteur files pour éviter le double rendu
    filesClose()
  }, [file?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
