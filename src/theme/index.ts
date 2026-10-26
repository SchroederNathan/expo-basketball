import type { TextStyle } from 'react-native';

// The app is dark only (app config sets the interface style), so the palette
// is one fixed set of values instead of light and dark pairs.
export const colors = {
  background: '#0A0A0A',
  backgroundClear: '#0A0A0A00',
  surfaceRaised: '#1C1C1E',
  fill: 'rgba(255, 255, 255, 0.05)',
  fillPressed: 'rgba(255, 255, 255, 0.1)',
  hairline: 'rgba(255, 255, 255, 0.08)',
  text: '#F3F3F3',
  textSecondary: '#B1B1B1',
  textTertiary: '#929292',
  textMuted: '#5E5E5E',
  accent: '#FF6A1F',
  live: '#F78252',
  onAccent: '#0A0A0A',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  full: 999,
} as const;

export const layout = {
  screenPadding: space.lg,
  minTouch: 44,
  rowHeight: 56,
} as const;

export const fonts = {
  display: 'BarlowCondensed_700Bold_Italic',
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  headline: { fontSize: 17, fontWeight: '600', color: colors.text },
  body: { fontSize: 17, fontWeight: '400', color: colors.text },
  callout: { fontSize: 16, fontWeight: '500', color: colors.text },
  subhead: { fontSize: 15, fontWeight: '400', color: colors.textSecondary },
  footnote: { fontSize: 13, fontWeight: '400', color: colors.textTertiary },
  caption: { fontSize: 12, fontWeight: '500', color: colors.textTertiary },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  score: { fontSize: 34, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;

export const displaySizes = {
  hero: 76,
  large: 46,
  medium: 32,
  small: 24,
} as const;
