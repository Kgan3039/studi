/**
 * Studi design tokens — Soft Editorial Utility.
 *
 * Source of truth: the Lovable Expo handoff
 * (Kgan3039/studi-your-campus-study-hub → docs/studi-expo-handoff.md §1).
 * This supersedes the earlier Sora/dog-ear Direction D tokens.
 *
 * Serif (Cormorant Garamond) is reserved for editorial hero moments:
 * onboarding, page heroes, session-detail title, profile name, empty-state
 * headlines. Utility surfaces (Messages, settings-like screens) are sans-only.
 */

import { Platform } from 'react-native';

const accentLight = '#A31621';
const accentDark = '#C43A46'; // hand-converted from oklch(0.55 0.19 25)

/**
 * Raw brand palette (handoff §1.1).
 * Legacy key names (red600, cream50, charcoal900, …) are kept so existing
 * screens compile unchanged; they now point at the handoff values. New code
 * should prefer the handoff-named keys; legacy aliases retire as screens
 * migrate.
 */
export const Brand = {
  // Handoff-named tokens
  accent: accentLight,
  accentPressed: '#8A121C',
  accentSoft: '#F5E1E3',
  bg: '#FBF7F0',
  surface: '#FFFFFF',
  surfaceAlt: '#F3EEE4',
  text: '#1F1B16',
  textMuted: '#6B6359',
  textSubtle: '#9A9387',
  success: '#3F7D5C',
  warning: '#B8791F',
  info: '#2F4A6B',
  overlay: 'rgba(31, 27, 22, 0.55)',

  // Legacy aliases (Direction D names) — same values as above
  red600: accentLight,
  red700: '#8A121C',
  red100: '#F5E1E3',
  cream50: '#FBF7F0',
  cream100: '#F3EEE4',
  card: '#FFFFFF',
  charcoal900: '#1F1B16',
  charcoal600: '#6B6359',
  charcoal400: '#9A9387',
  border: 'rgba(31, 27, 22, 0.08)',
  sunflower400: '#B8791F',
  lake500: '#2F4A6B',
  moss500: '#3F7D5C',
} as const;

/**
 * Department color system (handoff §1.2) — applies ONLY to CourseChip and
 * dept dots. Copied verbatim from src/components/studi/index.tsx deptColors.
 * Unknown departments use the foreground-tint fallback.
 */
export const DeptColors: Record<string, string> = {
  CS: '#A31621',
  MATH: '#1B2A4E',
  ECON: '#2D4A2B',
  PSYCH: '#4B2E5C',
  STAT: '#1F5C5E',
};

export function deptColorFor(code: string): string | undefined {
  return DeptColors[code.trim().split(/\s+/)[0]?.toUpperCase() ?? ''];
}

export const Colors = {
  light: {
    text: Brand.text,
    background: Brand.bg,
    tint: accentLight,
    icon: Brand.textMuted,
    tabIconDefault: Brand.textSubtle,
    tabIconSelected: accentLight,
    surface: Brand.surface,
    surfaceMuted: Brand.surfaceAlt,
    hero: Brand.accentSoft,
    badge: Brand.surfaceAlt,
    border: 'rgba(31, 27, 22, 0.08)',
    outline: 'rgba(31, 27, 22, 0.16)',
  },
  // Hand-converted from the handoff's .dark oklch values (src/styles.css).
  dark: {
    text: '#F7F2E9',
    background: '#1C1612',
    tint: accentDark,
    icon: '#A89F92',
    tabIconDefault: '#8A8174',
    tabIconSelected: accentDark,
    surface: '#251E18',
    surfaceMuted: '#2E2620',
    hero: '#3A2024',
    badge: '#2E2620',
    border: 'rgba(255, 255, 255, 0.10)',
    outline: 'rgba(255, 255, 255, 0.14)',
  },
};

/**
 * Font families loaded in app/_layout.tsx via @expo-google-fonts.
 * Names must match the keys passed to useFonts there.
 */
export const FontFamily = {
  serif: 'CormorantGaramond_500Medium',
  serifItalic: 'CormorantGaramond_500Medium_Italic',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  code: 'SpaceGrotesk_500Medium',
} as const;

/**
 * Type scale (handoff §1.3). Legacy keys (title, heading, label, caption)
 * remain for existing screens; handoff-named roles added alongside.
 */
export const TypeScale = {
  /** Onboarding hero, brand moments — serif italic. */
  display: { fontFamily: FontFamily.serifItalic, fontSize: 34, lineHeight: 40 },
  /** Page hero / h1 — serif. */
  title: { fontFamily: FontFamily.serif, fontSize: 28, lineHeight: 34 },
  /** Section titles / h2 — sans. */
  h2: { fontFamily: FontFamily.bodySemiBold, fontSize: 22, lineHeight: 28 },
  /** Card titles / h3 — sans. (Legacy name "heading".) */
  heading: { fontFamily: FontFamily.bodySemiBold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: FontFamily.body, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: FontFamily.bodySemiBold, fontSize: 15, lineHeight: 22 },
  /** Buttons, tabs, chip text. */
  label: { fontFamily: FontFamily.bodySemiBold, fontSize: 13, lineHeight: 18 },
  /** Metadata, timestamps. */
  meta: { fontFamily: FontFamily.bodyMedium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: FontFamily.body, fontSize: 12, lineHeight: 16 },
  /** Uppercase eyebrows. */
  eyebrow: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.88,
    textTransform: 'uppercase' as const,
  },
  /** Course codes. */
  code: { fontFamily: FontFamily.code, fontSize: 13, lineHeight: 16, letterSpacing: 0.5 },
} as const;

/**
 * Radius scale (handoff §1.5) — fully rounded/pill system.
 * The Direction D dog-ear corner is retired: `accentCorner` now equals the
 * card radius so existing `borderTopRightRadius` usages collapse to uniform
 * corners until screens drop them.
 */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 9999,

  // Legacy aliases
  chip: 12,
  card: 20,
  accentCorner: 20,
} as const;

/** 4pt spacing scale (handoff §1.4). */
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Shadows / elevation (handoff §1.6). Spread into StyleSheet objects. */
export const Elevation = {
  e1: {
    shadowColor: Brand.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  e2: {
    shadowColor: Brand.text,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 6,
  },
  e3: {
    shadowColor: Brand.text,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
    elevation: 12,
  },
} as const;

/** Motion durations in ms (handoff §1.7). Respect Reduce Motion. */
export const Motion = {
  fast: 160,
  base: 240,
  slow: 400,
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
