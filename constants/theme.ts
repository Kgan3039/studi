/** Studi design tokens — Campus Editorial Utility. */

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
  accent: accentLight,
  accentPressed: '#8A121C',
  accentSoft: '#F2DCDD',
  bg: '#F8F4EC',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EBE2',
  text: '#1C1915',
  textMuted: '#686158',
  textSubtle: '#91897E',
  success: '#387052',
  warning: '#9A661D',
  info: '#345574',
  overlay: 'rgba(28, 25, 21, 0.58)',

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
  border: '#DDD6CB',
  sunflower400: '#9A661D',
  lake500: '#345574',
  moss500: '#387052',
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
    border: '#DDD6CB',
    outline: '#BEB5A8',
    // Semantic aliases for shared UI. Existing keys remain supported while
    // product screens migrate incrementally.
    accent: accentLight,
    primaryText: Brand.text,
    secondaryText: Brand.textMuted,
    mutedSurface: Brand.surfaceAlt,
    destructive: accentLight,
    success: Brand.success,
    warning: Brand.warning,
  },
  // Hand-converted from the handoff's .dark oklch values (src/styles.css).
  dark: {
    text: '#F7F2E9',
    background: '#181512',
    tint: accentDark,
    icon: '#A89F92',
    tabIconDefault: '#8A8174',
    tabIconSelected: accentDark,
    surface: '#24201C',
    surfaceMuted: '#2C2722',
    hero: '#3A2024',
    badge: '#2E2620',
    border: '#3E3831',
    outline: '#5B534A',
    accent: accentDark,
    primaryText: '#F7F2E9',
    secondaryText: '#A89F92',
    mutedSurface: '#2E2620',
    destructive: accentDark,
    success: '#8FBF9F',
    warning: '#D9A45C',
  },
};

/**
 * Font families loaded in app/_layout.tsx via @expo-google-fonts.
 * Names must match the keys passed to useFonts there.
 */
export const FontFamily = {
  serif: 'Arapey_400Regular',
  serifItalic: 'Arapey_400Regular_Italic',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  code: 'Inter_600SemiBold',
} as const;

/**
 * Type scale (handoff §1.3). Legacy keys (title, heading, label, caption)
 * remain for existing screens; handoff-named roles added alongside.
 */
const screenTitleType = {
  fontFamily: FontFamily.serif,
  fontSize: 32,
  lineHeight: 36,
} as const;

export const TypeScale = {
  /** Onboarding hero, brand moments — serif italic. */
  display: { fontFamily: FontFamily.serifItalic, fontSize: 36, lineHeight: 40 },
  /** Legacy top-level title alias; kept compatible during migration. */
  title: screenTitleType,
  /** Canonical top-level screen title. Every major route uses this role. */
  screenTitle: screenTitleType,
  /** Section titles / h2 — sans. */
  h2: { fontFamily: FontFamily.bodySemiBold, fontSize: 20, lineHeight: 25 },
  /** Card titles / h3 — sans. (Legacy name "heading".) */
  heading: { fontFamily: FontFamily.bodySemiBold, fontSize: 16, lineHeight: 21 },
  sectionTitle: { fontFamily: FontFamily.bodySemiBold, fontSize: 18, lineHeight: 23 },
  itemTitle: { fontFamily: FontFamily.bodySemiBold, fontSize: 16, lineHeight: 21 },
  body: { fontFamily: FontFamily.body, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: FontFamily.bodySemiBold, fontSize: 16, lineHeight: 23 },
  /** Buttons, tabs, chip text. */
  label: { fontFamily: FontFamily.bodySemiBold, fontSize: 14, lineHeight: 18 },
  /** Metadata, timestamps. */
  meta: { fontFamily: FontFamily.body, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: FontFamily.body, fontSize: 12, lineHeight: 16 },
  micro: { fontFamily: FontFamily.bodyMedium, fontSize: 12, lineHeight: 16 },
  /** Legacy alias. Rendered in sentence case to prevent eyebrow overuse. */
  eyebrow: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    textTransform: 'none' as const,
  },
  /** Course codes. */
  code: { fontFamily: FontFamily.code, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
} as const;

/**
 * Radius scale (handoff §1.5) — fully rounded/pill system.
 * The Direction D dog-ear corner is retired: `accentCorner` now equals the
 * card radius so existing `borderTopRightRadius` usages collapse to uniform
 * corners until screens drop them.
 */
export const Radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  pill: 9999,

  // Legacy aliases
  chip: 8,
  card: 12,
  accentCorner: 12,
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
  e1: {},
  e2: {
    shadowColor: Brand.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  e3: {
    shadowColor: Brand.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
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
