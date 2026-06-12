/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#C8102E';
const tintColorDark = '#E34A5A';

/**
 * Direction D brand tokens (docs/design-direction.md §2).
 * Raw palette values; screens should usually read the scheme-aware
 * `Colors` below, and use these for the small-dose accents.
 */
export const Brand = {
  red600: '#C8102E',
  red700: '#A30D26',
  red100: '#F9E2E2',
  cream50: '#FFF8F0',
  cream100: '#F8EFE3',
  card: '#FFFDF9',
  charcoal900: '#231A16',
  charcoal600: '#6E5F58',
  charcoal400: '#9C8C85',
  border: '#EAD9CC',
  sunflower400: '#F0B441',
  lake500: '#2E6E8E',
  moss500: '#4E7A4E',
} as const;

export const Colors = {
  light: {
    text: Brand.charcoal900,
    background: Brand.cream50,
    tint: tintColorLight,
    icon: Brand.charcoal600,
    tabIconDefault: '#8F7D78',
    tabIconSelected: tintColorLight,
    surface: Brand.card,
    surfaceMuted: Brand.cream100,
    hero: '#F7E2DE',
    badge: '#F3DFC1',
    border: Brand.border,
    outline: '#DAB8AC',
  },
  dark: {
    text: '#F6F0ED',
    background: '#171211',
    tint: tintColorDark,
    icon: '#B4A6A1',
    tabIconDefault: '#9F918B',
    tabIconSelected: '#F0C36A',
    surface: '#211918',
    surfaceMuted: '#2B211F',
    hero: '#341718',
    badge: '#52352C',
    border: '#4B312D',
    outline: '#68443B',
  },
};

/**
 * Type scale (design-direction.md §3). Font families are loaded in
 * app/_layout.tsx via @expo-google-fonts; these names must match the
 * keys passed to useFonts there.
 */
export const FontFamily = {
  displayBold: 'Sora_700Bold',
  display: 'Sora_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  code: 'SpaceGrotesk_500Medium',
} as const;

export const TypeScale = {
  display: { fontFamily: FontFamily.displayBold, fontSize: 32, lineHeight: 38 },
  title: { fontFamily: FontFamily.display, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: FontFamily.display, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: FontFamily.body, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: FontFamily.bodySemiBold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: FontFamily.body, fontSize: 12, lineHeight: 16 },
  code: { fontFamily: FontFamily.code, fontSize: 13, lineHeight: 16, letterSpacing: 0.5 },
} as const;

/**
 * Shape language (design-direction.md §1): 20px base radius with one
 * 32px "dog-eared" corner on cards, buttons, and avatars.
 */
export const Radius = {
  chip: 10,
  card: 20,
  accentCorner: 32,
  pill: 9999,
} as const;

export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
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
