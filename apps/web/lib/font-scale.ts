// Font-scale preference (UDT-52).
//
// A user-selectable root font-size level, persisted in a plain (non-httpOnly)
// cookie so the server root layout can read it and set `data-font-scale` on
// <html> during SSR — no flash — while the client can update it live from the
// Settings page. localStorage is intentionally avoided (project rule).

export const FONT_SCALE_COOKIE = 'font-scale'

export const FONT_SCALES = ['100', '125', '150'] as const
export type FontScale = (typeof FONT_SCALES)[number]

export const DEFAULT_FONT_SCALE: FontScale = '100'

export function isFontScale(value: string | undefined | null): value is FontScale {
  return value != null && (FONT_SCALES as readonly string[]).includes(value)
}

export function normalizeFontScale(value: string | undefined | null): FontScale {
  return isFontScale(value) ? value : DEFAULT_FONT_SCALE
}

// Short labels for the Settings control (percentage rendered separately).
export const FONT_SCALE_LABELS: Record<FontScale, string> = {
  '100': 'ปกติ',
  '125': 'ใหญ่',
  '150': 'ใหญ่พิเศษ',
}

// Client-only: apply a scale immediately (live, no reload) and persist it.
export function applyFontScale(scale: FontScale): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.fontScale = scale
  // ~1 year, path=/ so every route sees it, lax so it rides top-level nav.
  document.cookie = `${FONT_SCALE_COOKIE}=${scale}; path=/; max-age=31536000; samesite=lax`
}

// Client-only: read the current scale from the live <html> attribute (set SSR),
// falling back to the cookie, then the default.
export function readFontScale(): FontScale {
  if (typeof document !== 'undefined') {
    const fromAttr = document.documentElement.dataset.fontScale
    if (isFontScale(fromAttr)) return fromAttr
    const match = document.cookie.match(/(?:^|;\s*)font-scale=([^;]+)/)
    if (match && isFontScale(match[1])) return match[1]
  }
  return DEFAULT_FONT_SCALE
}
