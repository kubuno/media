import { Clapperboard, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FloatingWindow } from '@ui'
import { useTrailerStore } from './store/trailerStore'

export default function TrailerPlayer() {
  const { t } = useTranslation('media')
  const { isOpen, title, year, trailerKey, close } = useTrailerStore()

  if (!isOpen) return null

  const windowTitle = `${title}${year ? ` (${year})` : ''} — ${t('media_trailer_title')}`

  return (
    <FloatingWindow
      title={windowTitle}
      icon={<Clapperboard className="w-4 h-4" />}
      onClose={close}
      defaultWidth={640}
      defaultHeight={410}
      minWidth={320}
      minHeight={220}
      resizable
    >
      {trailerKey ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1`}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          title={windowTitle}
        />
      ) : (
        <NoTrailerFallback title={title} year={year} />
      )}
    </FloatingWindow>
  )
}

function NoTrailerFallback({ title, year }: { title: string; year: number | null }) {
  const { t } = useTranslation('media')
  const query = encodeURIComponent(`${title}${year ? ` ${year}` : ''} ${t('media_trailer_search_suffix')}`)
  const ytUrl  = `https://www.youtube.com/results?search_query=${query}`

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-8 text-center bg-surface-1">
      <Clapperboard className="w-12 h-12 text-text-tertiary" />
      <div>
        <p className="font-medium text-text-primary mb-1">{t('media_trailer_none_title')}</p>
        <p className="text-sm text-text-secondary">
          {t('media_trailer_none_desc')}
        </p>
      </div>
      <a
        href={ytUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary-hover transition-colors"
      >
        <ExternalLink className="w-4 h-4" />
        {t('media_trailer_search_youtube')}
      </a>
    </div>
  )
}
