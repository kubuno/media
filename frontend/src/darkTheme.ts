import type React from 'react'

// Override the shared theme tokens to a dark palette on a page wrapper. Every
// child utility (text-text-*, bg-surface-*, border-border…) re-reads these CSS
// variables, so the whole sub-page turns dark without touching each component.
export const DARK_PAGE = {
  background: 'linear-gradient(180deg, #191b20 0%, #101114 100%)',
  '--color-text-primary':   '#f2f3f5',
  '--color-text-secondary': '#c5c8ce',
  '--color-text-tertiary':  '#9a9da5',
  '--color-surface-0':      '#1b1d22',
  '--color-surface-1':      '#202228',
  '--color-surface-2':      '#262930',
  '--color-surface-3':      '#31343c',
  '--color-border':         'rgba(255,255,255,0.10)',
  '--color-border-strong':  'rgba(255,255,255,0.20)',
  '--color-search-bg':      '#262930',
  // Neutral charcoal + electric-blue accent — same identity as the DJ console
  // (media palette rule: no cyan, no violet, no pink).
  '--color-primary':        '#2f7dff',
  '--color-primary-hover':  '#1f66e8',
  '--color-primary-light':  'rgba(47,125,255,0.22)',
} as React.CSSProperties
