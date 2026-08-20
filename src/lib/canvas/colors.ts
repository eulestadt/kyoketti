import type { CanvasColor } from './types'

/** Obsidian-style canvas color presets (app-defined hex). */
export const CANVAS_PRESET_COLORS: Record<string, { light: string; dark: string; label: string }> = {
  '1': { light: '#ef4444', dark: '#f87171', label: 'Red' },
  '2': { light: '#f97316', dark: '#fb923c', label: 'Orange' },
  '3': { light: '#eab308', dark: '#facc15', label: 'Yellow' },
  '4': { light: '#22c55e', dark: '#4ade80', label: 'Green' },
  '5': { light: '#06b6d4', dark: '#22d3ee', label: 'Cyan' },
  '6': { light: '#a855f7', dark: '#c084fc', label: 'Purple' },
}

export function resolveCanvasColor(
  color: CanvasColor | undefined,
  theme: 'light' | 'dark',
  fallback = 'var(--border)',
): string {
  if (!color) return fallback
  if (color.startsWith('#')) return color
  const preset = CANVAS_PRESET_COLORS[color]
  if (preset) return theme === 'dark' ? preset.dark : preset.light
  return fallback
}

export function canvasAccentBorder(color: CanvasColor | undefined, theme: 'light' | 'dark'): string | undefined {
  if (!color) return undefined
  return resolveCanvasColor(color, theme)
}
