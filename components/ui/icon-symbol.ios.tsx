import { SymbolView, SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { StyleProp, ViewStyle } from 'react-native';

export type IconSymbolName = SymbolViewProps['name'];

/**
 * Symbols that are much wider than they are tall. `scaleAspectFit` inside a
 * square frame scales those down until their *width* fits, so at a shared
 * `size` they render visually smaller than a square glyph sitting next to them
 * — a person-with-badge looks shrunken beside a triangle or a circle. These
 * get a slightly taller frame so every icon in a row reads at one weight.
 */
const OPTICAL_SCALE: Partial<Record<string, number>> = {
  // Badge glyphs are optically wider than the safety actions beside them, but
  // 1.18 made the badge sit noticeably lower than a triangle or no-entry
  // symbol in a 44pt action. This smaller correction keeps the three aligned.
  'person.badge.plus': 1.1,
  'person.badge.minus': 1.1,
  'person.crop.circle.badge.xmark': 1.14,
  'person.2.fill': 1.1,
  'rectangle.portrait.and.arrow.right': 1.1,
};

// SF Symbols places the badge below the person glyph's geometric center.
// Shift only the artwork, leaving the shared 44pt tap target untouched, so it
// meets the visible middle of the adjacent warning and block actions.
const OPTICAL_OFFSET_Y: Partial<Record<string, number>> = {
  'person.badge.plus': 3,
  'person.badge.minus': 3,
};

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: IconSymbolName;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}) {
  const symbolName = name as string;
  const scaled = size * (OPTICAL_SCALE[symbolName] ?? 1);
  const offsetY = OPTICAL_OFFSET_Y[symbolName] ?? 0;

  return (
    <SymbolView
      weight={weight}
      tintColor={color}
      resizeMode="scaleAspectFit"
      name={name}
      style={[
        {
          width: scaled,
          height: scaled,
          transform: offsetY === 0 ? undefined : [{ translateY: offsetY }],
        },
        style,
      ]}
    />
  );
}
