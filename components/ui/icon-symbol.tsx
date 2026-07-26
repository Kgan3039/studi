// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialIcons>['name']>;
export type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  'house.fill': 'home',
  calendar: 'event',
  'message.fill': 'chat',
  message: 'chat-bubble-outline',
  'person.crop.circle.fill': 'account-circle',
  'person.2.fill': 'group',
  'paperplane.fill': 'send',
  'map.fill': 'map',
  'mappin.and.ellipse': 'place',
  'plus.circle.fill': 'add-circle',
  'slider.horizontal.3': 'tune',
  'arrow.up.right': 'north-east',
  'arrow.clockwise': 'refresh',
  bell: 'notifications-none',
  clock: 'schedule',
  'book.closed': 'menu-book',
  'line.3.horizontal.decrease': 'filter-list',
  'gearshape.fill': 'settings',
  'star.fill': 'star',
  'person.badge.plus': 'person-add-alt-1',
  'square.and.pencil': 'edit',
  'checkmark.circle.fill': 'check-circle',
  xmark: 'close',
  'info.circle': 'info-outline',
  'exclamationmark.triangle': 'warning-amber',
  'envelope.fill': 'email',
  'lock.shield.fill': 'verified-user',
  'bell.badge.fill': 'notifications-active',
  'rectangle.portrait.and.arrow.right': 'logout',
  'trash.fill': 'delete',
  'hand.raised.fill': 'privacy-tip',
  // Blocking uses the universal "no entry" sign, not a raised hand.
  nosign: 'block',
  'person.crop.circle.badge.xmark': 'person-off',
  'arrow.up.arrow.down': 'swap-vert',
  checkmark: 'check',
  'questionmark.circle.fill': 'help',
  'circle.dashed': 'radio-button-unchecked',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'chevron.left': 'chevron-left',
  eye: 'visibility',
  'eye.slash': 'visibility-off',
  magnifyingglass: 'search',
  'xmark.circle.fill': 'cancel',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
