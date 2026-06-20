import type React from 'react'

// Override the shared theme tokens to a dark palette on a page wrapper. Every
// child utility (text-text-*, bg-surface-*, border-border…) re-reads these CSS
// variables, so the whole sub-page turns dark without touching each component.
export const DARK_PAGE = {
  background: 'linear-gradient(180deg, #17151f 0%, #141320 100%)',
  '--color-text-primary':   '#f3f2f9',
  '--color-text-secondary': '#c3c0d6',
  '--color-text-tertiary':  '#9a98ae',
  '--color-surface-0':      '#1b1928',
  '--color-surface-1':      '#201d2e',
  '--color-surface-2':      '#272338',
  '--color-surface-3':      '#322d46',
  '--color-border':         'rgba(255,255,255,0.10)',
  '--color-border-strong':  'rgba(255,255,255,0.20)',
  '--color-search-bg':      '#272338',
  // Unify accents on violet (instead of the light-theme blue, which reads harsh
  // on dark) so primary buttons / active chips match the music section.
  '--color-primary':        '#8b5cf6',
  '--color-primary-hover':  '#7c4ef0',
  '--color-primary-light':  'rgba(139,92,246,0.22)',
} as React.CSSProperties
