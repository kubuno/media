/** Bundle MODULE media — chargé à l'exécution (cf. vite.module.config). */
import { lazy } from 'react'
import { RouteRegistry, WaffleAppRegistry, SlotRegistry, useSidebarStore, SDK_VERSION } from '@kubuno/sdk'
import { Tv, Music } from 'lucide-react'
import './index.css'
import './i18n'
import MediaSidebarBody from './MediaSidebarBody'
import MusicPlayer from './components/listen/player/MusicPlayer'
import FilesAudioBridge from './FilesAudioBridge'
import FilesVideoFloatingPlayer from './FilesVideoFloatingPlayer'
import MediaVideoPlayer from './MediaVideoPlayer'
import TrailerPlayer from './TrailerPlayer'

export const sdkVersion = SDK_VERSION

export function register() {
  // Noms d'applications = marques, jamais traduits.
  WaffleAppRegistry.register('media', 'Media', [
    { id: 'media-watch',  label: 'Watch',  Icon: Tv,    path: '/media/watch'  },
    { id: 'media-listen', label: 'Listen', Icon: Music, path: '/media/listen' },
  ])

  useSidebarStore.getState().register({
    moduleId:    'media',
    routePrefix: '/media',
    SidebarBody: MediaSidebarBody,
    collapsedBody: true,
  })

  // Lecteur audio flottant (bibliothèque musicale)
  SlotRegistry.register('app-dialogs', 'media', MusicPlayer)
  // Bridge : intercepte les fichiers audio ouverts depuis le module files
  // et les redirige vers le lecteur du module media (plus riche)
  SlotRegistry.register('app-dialogs', 'media', FilesAudioBridge)
  // Surcharge le lecteur vidéo plein écran de files par une fenêtre flottante
  SlotRegistry.registerOverride('files-video-player', 'media', FilesVideoFloatingPlayer)
  // Lecteur vidéo flottant pour les films du module media
  SlotRegistry.register('app-dialogs', 'media', MediaVideoPlayer)
  // Lecteur de bande annonce flottant (YouTube embed)
  SlotRegistry.register('app-dialogs', 'media', TrailerPlayer)

  // Routes
  const WatchPage       = lazy(() => import('./pages/WatchPage'))
  const MovieDetailPage = lazy(() => import('./pages/MovieDetailPage'))
  const ListenPage      = lazy(() => import('./pages/ListenPage'))
  const DJPage          = lazy(() => import('./pages/DJPage'))
  const RadioPage       = lazy(() => import('./pages/RadioPage'))

  RouteRegistry.register('media/watch',                WatchPage)
  RouteRegistry.register('media/watch/shows',          WatchPage)
  RouteRegistry.register('media/watch/continue',       WatchPage)
  RouteRegistry.register('media/watch/movie/:id',      MovieDetailPage)
  RouteRegistry.register('media/watch/show/:id',       WatchPage)
  RouteRegistry.register('media/listen',               ListenPage)
  RouteRegistry.register('media/listen/albums',        ListenPage)
  RouteRegistry.register('media/listen/playlists',     ListenPage)
  RouteRegistry.register('media/listen/liked',         ListenPage)
  RouteRegistry.register('media/listen/recent',        ListenPage)
  RouteRegistry.register('media/listen/artist/:id',    ListenPage)
  RouteRegistry.register('media/listen/album/:id',     ListenPage)
  RouteRegistry.register('media/listen/playlist/:id',  ListenPage)
  RouteRegistry.register('media/listen/dj',            DJPage)
  RouteRegistry.register('media/listen/radio',         RadioPage)
}
