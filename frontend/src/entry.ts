/** Bundle MODULE media — chargé à l'exécution (cf. vite.module.config). */
import { lazy } from 'react'
import { RouteRegistry, WaffleAppRegistry, SlotRegistry, ModuleSettingsRegistry, useSidebarStore, useToolbarStore, useSearchStore, SDK_VERSION } from '@kubuno/sdk'
import { useMediaSearchStore } from './store/mediaSearchStore'
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

  // The header gear button opens the per-user Media settings while in /media.
  ModuleSettingsRegistry.register('media')

  useSidebarStore.getState().register({
    moduleId:    'media',
    routePrefix: '/media',
    SidebarBody: MediaSidebarBody,
    collapsedBody: true,
  })

  // Settings page: hide the shell SearchBar (no in-page search on this route).
  useToolbarStore.getState().register({
    moduleId:    'media-settings',
    routePrefix: '/media/settings',
  })
  useSearchStore.getState().register({ moduleId: 'media-settings', routePrefix: '/media/settings', placeholder: '', SearchComponent: () => null })

  // DJ console: full-bleed (no content padding). Combined with the page's own
  // chromeless header, the mixer fills the whole shell content area.
  useToolbarStore.getState().register({
    moduleId:    'media-dj',
    routePrefix: '/media/listen/dj',
    noPadding:   true,
  })

  // Watch & Listen pages are full-bleed: their gradient hero must reach the
  // edges of the content card (no shell p-6 around it). The pages add their own
  // inner padding for the content grids.
  useToolbarStore.getState().register({ moduleId: 'media-watch',  routePrefix: '/media/watch',  noPadding: true })
  useToolbarStore.getState().register({ moduleId: 'media-listen', routePrefix: '/media/listen', noPadding: true })

  // Search: drive the shell's shared SearchBar per route instead of in-page
  // search inputs. The active page reads the query from useMediaSearchStore.
  // Distinct moduleId per case so the SearchBar clears the query on tab change.
  const search   = useSearchStore.getState()
  const setQuery = (q: string) => useMediaSearchStore.getState().setQuery(q)
  search.register({ moduleId: 'media-movies',  routePrefix: '/media/watch',          placeholder: 'Rechercher un film…',    placeholderKey: 'media:media_search_movies',  onSearch: setQuery })
  search.register({ moduleId: 'media-shows',   routePrefix: '/media/watch/shows',    placeholder: 'Rechercher une série…',  placeholderKey: 'media:media_search_shows',   onSearch: setQuery })
  search.register({ moduleId: 'media-artists', routePrefix: '/media/listen',         placeholder: 'Rechercher un artiste…', placeholderKey: 'media:media_search_artists', onSearch: setQuery })
  search.register({ moduleId: 'media-albums',  routePrefix: '/media/listen/albums',  placeholder: 'Rechercher un album…',   placeholderKey: 'media:media_search_albums',  onSearch: setQuery })
  // Routes without a search feature: hide the shell SearchBar (override with an
  // empty component) so a parent prefix's placeholder doesn't bleed in.
  const NoSearch = () => null
  for (const [moduleId, routePrefix] of [
    ['media-watch-continue', '/media/watch/continue'],
    ['media-movie-detail',   '/media/watch/movie'],
    ['media-show-detail',    '/media/watch/show'],
    ['media-playlists',      '/media/listen/playlists'],
    ['media-liked',          '/media/listen/liked'],
    ['media-recent',         '/media/listen/recent'],
    ['media-artist-detail',  '/media/listen/artist'],
    ['media-album-detail',   '/media/listen/album'],
    ['media-playlist-detail','/media/listen/playlist'],
    ['media-radio',          '/media/listen/radio'],
  ] as const) search.register({ moduleId, routePrefix, placeholder: '', SearchComponent: NoSearch })

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
  const MediaSettingsPage = lazy(() => import('./MediaSettingsPage'))

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
  RouteRegistry.register('media/settings',             MediaSettingsPage)
}
