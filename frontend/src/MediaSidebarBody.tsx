import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Film, Clapperboard, ListMusic,
  Clock, Heart, PlayCircle, Disc3, Mic2,
} from 'lucide-react'
import { SidebarNavItem } from '@kubuno/sdk'

function SectionLabel({ label, collapsed }: { label: string; collapsed?: boolean }) {
  if (collapsed) return <div className="mx-2 my-2 h-px bg-border" />
  return (
    <div className="px-3 pt-4 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </span>
    </div>
  )
}

const WATCH_ITEMS = [
  { labelKey: 'media_nav_movies',       icon: <Film className="w-4 h-4 flex-shrink-0" />,        path: '/media/watch' },
  { labelKey: 'media_nav_shows',        icon: <Clapperboard className="w-4 h-4 flex-shrink-0" />, path: '/media/watch/shows' },
  { labelKey: 'media_nav_continue',     icon: <Clock className="w-4 h-4 flex-shrink-0" />,        path: '/media/watch/continue' },
]

const LISTEN_ITEMS = [
  { labelKey: 'media_nav_artists',      icon: <Mic2 className="w-4 h-4 flex-shrink-0" />,        path: '/media/listen' },
  { labelKey: 'media_nav_albums',       icon: <Disc3 className="w-4 h-4 flex-shrink-0" />,       path: '/media/listen/albums' },
  { labelKey: 'media_nav_playlists',    icon: <ListMusic className="w-4 h-4 flex-shrink-0" />,   path: '/media/listen/playlists' },
  { labelKey: 'media_nav_favorites',    icon: <Heart className="w-4 h-4 flex-shrink-0" />,       path: '/media/listen/liked' },
  { labelKey: 'media_nav_recent',       icon: <PlayCircle className="w-4 h-4 flex-shrink-0" />,  path: '/media/listen/recent' },
]

export default function MediaSidebarBody({ collapsed = false }: { collapsed?: boolean }) {
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const { t }        = useTranslation('media')

  const isActive = (path: string) =>
    path === '/media/watch'  ? pathname === path || (pathname.startsWith('/media/watch') && !WATCH_ITEMS.slice(1).some(i => pathname.startsWith(i.path))) :
    path === '/media/listen' ? pathname === path || (pathname.startsWith('/media/listen') && !LISTEN_ITEMS.slice(1).some(i => pathname.startsWith(i.path))) :
    pathname === path || pathname.startsWith(path + '/')

  return (
    <nav className={`flex-1 overflow-y-auto py-1 space-y-0.5 ${collapsed ? "px-2" : "px-3"}`}>
      <SectionLabel collapsed={collapsed} label={t('media_section_video')} />
      {WATCH_ITEMS.map(({ labelKey, icon, path }) => (
        <SidebarNavItem collapsed={collapsed} key={path} label={t(labelKey)} icon={icon}
          active={isActive(path)} onClick={() => navigate(path)} />
      ))}

      <SectionLabel collapsed={collapsed} label={t('media_section_music')} />
      {LISTEN_ITEMS.map(({ labelKey, icon, path }) => (
        <SidebarNavItem collapsed={collapsed} key={path} label={t(labelKey)} icon={icon}
          active={isActive(path)} onClick={() => navigate(path)} />
      ))}
    </nav>
  )
}
