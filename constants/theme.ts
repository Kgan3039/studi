/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#C8102E';
const tintColorDark = '#E34A5A';

export const Colors = {
  light: {
    text: '#201815',
    background: '#FFF8F4',
    tint: tintColorLight,
    icon: '#7B6A66',
    tabIconDefault: '#8F7D78',
    tabIconSelected: tintColorLight,
    surface: '#FFFDF9',
    surfaceMuted: '#F9EFE8',
    hero: '#F7E2DE',
    badge: '#F3DFC1',
    border: '#E7CEC4',
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
