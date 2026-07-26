import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, FontFamily } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 72 } as const;

export type AvatarSize = keyof typeof SIZES;

export type AvatarProps = {
  name: string;
  size?: AvatarSize;
  /**
   * Crimson check badge. Truthful in Studi: every signed-in account has a
   * verified @wisc.edu email, so callers may set this for any real user.
   */
  verified?: boolean;
  tone?: 'default' | 'accent';
  style?: StyleProp<ViewStyle>;
};

/**
 * Initials avatar (handoff §2): foreground disc with background-colored
 * initials; accent tone for brand moments. Verified = crimson check badge.
 */
export function Avatar({ name, size = 'md', verified = false, tone = 'default', style }: AvatarProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const px = SIZES[size];

  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'S';

  const discColor = tone === 'accent' ? palette.tint : palette.text;

  return (
    <View style={[{ width: px, height: px }, style]}>
      <View
        style={[
          styles.disc,
          { width: px, height: px, borderRadius: px / 2, backgroundColor: discColor },
        ]}>
        {/* The disc is a fixed-size graphic, so initials must not scale with
            Dynamic Type — they would overflow and clip inside it. */}
        <Text
          allowFontScaling={false}
          style={{
            color: palette.background,
            fontFamily: FontFamily.bodySemiBold,
            fontSize: px * 0.38,
            lineHeight: px * 0.5,
          }}>
          {initials}
        </Text>
      </View>
      {verified ? (
        <View
          style={[
            styles.badge,
            {
              width: Math.max(px * 0.36, 12),
              height: Math.max(px * 0.36, 12),
              borderRadius: Math.max(px * 0.18, 6),
              backgroundColor: palette.tint,
              borderColor: palette.background,
            },
          ]}>
          <Text
            style={{
              color: '#FFFFFF',
              fontFamily: FontFamily.bodySemiBold,
              fontSize: Math.max(px * 0.2, 7),
              lineHeight: Math.max(px * 0.26, 9),
            }}>
            ✓
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export type AvatarStackProps = {
  names: string[];
  max?: number;
  size?: AvatarSize;
  /**
   * Total people the stack represents when only some names are known
   * (e.g. participantIds count with just the current user's name resolved).
   * The "+N" chip covers the difference without inventing initials.
   */
  totalCount?: number;
  style?: StyleProp<ViewStyle>;
};

/** Overlapping avatar row with a "+N" chip (handoff §2). */
export function AvatarStack({ names, max = 4, size = 'sm', totalCount, style }: AvatarStackProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const px = SIZES[size];
  const shown = names.slice(0, max);
  const extra = Math.max((totalCount ?? names.length) - shown.length, 0);

  return (
    <View style={[styles.stack, style]}>
      {shown.map((name, index) => (
        <View
          key={`${name}-${index}`}
          style={[
            styles.stackItem,
            { borderColor: palette.background, marginLeft: index === 0 ? 0 : -px * 0.25 },
          ]}>
          <Avatar name={name} size={size} />
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.extraChip,
            styles.stackItem,
            {
              width: px,
              height: px,
              borderRadius: px / 2,
              marginLeft: -px * 0.25,
              backgroundColor: palette.surfaceMuted,
              borderColor: palette.background,
            },
          ]}>
          <Text
            allowFontScaling={false}
            style={{
              color: palette.icon,
              fontFamily: FontFamily.bodySemiBold,
              fontSize: px * 0.34,
              lineHeight: px * 0.44,
            }}>
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackItem: {
    borderWidth: 2,
    borderRadius: 999,
  },
  extraChip: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
