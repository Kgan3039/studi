import type { Timestamp } from 'firebase/firestore';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { SeatPips } from '@/components/ui/SeatPips';
import { Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { StudySession } from '@/lib/firestore';

/**
 * The fields the card actually reads — a subset of StudySession so both
 * screen view models (SessionListEntry, StudySessionListItem) satisfy it.
 */
export type SessionCardSession = Pick<
  StudySession,
  'sessionId' | 'classId' | 'title' | 'startTime' | 'endTime' | 'status' | 'participantIds'
>;

export type SessionCardProps = {
  session: SessionCardSession;
  /** Resolved display name of the location; falls back to nothing shown. */
  locationName?: string;
  /** Not in the data model yet — pips render without hollow seats when omitted. */
  capacity?: number;
  /** Location rating aggregate, when the caller has loaded it. */
  locationRating?: number;
  /** No virtual-session field exists yet; callers opt in explicitly. */
  isOnline?: boolean;
  /** First names shown next to the pips ("Maya, Jordan +1"). */
  attendeeNames?: string[];
  /** Current user is a participant. */
  joined?: boolean;
  /** Join request in flight. */
  joining?: boolean;
  /** Red left-edge stripe — "Your next session" treatment on Today. */
  accent?: boolean;
  /** compact: the small card for horizontal rails. */
  variant?: 'full' | 'compact';
  onPress?: () => void;
  onJoin?: () => void;
  style?: StyleProp<ViewStyle>;
};

const STARTING_SOON_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatTime(date: Date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Relative when close (design-direction.md §6): "in 45 min", "Today 4:00 PM",
 * "Tomorrow 10:00 AM", then "Mon, Jun 15 · 4:00 PM".
 */
export function formatSessionStart(startTime: Timestamp, now: Date = new Date()) {
  const start = startTime.toDate();
  const diffMs = start.getTime() - now.getTime();

  if (diffMs > 0 && diffMs < STARTING_SOON_MS) {
    return `in ${Math.max(Math.round(diffMs / 60000), 1)} min`;
  }
  if (start.toDateString() === now.toDateString()) {
    return `Today ${formatTime(start)}`;
  }
  if (start.toDateString() === new Date(now.getTime() + DAY_MS).toDateString()) {
    return `Tomorrow ${formatTime(start)}`;
  }
  return `${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatTime(start)}`;
}

function formatAttendees(names: string[]) {
  const shown = names.slice(0, 2).map((name) => name.split(' ')[0]);
  const more = names.length - shown.length;
  return more > 0 ? `${shown.join(', ')} +${more}` : shown.join(', ');
}

/**
 * The core Direction D component (design-direction.md §6): course chip first,
 * one-line title, time + place, seat pips, one primary action.
 */
export function SessionCard({
  session,
  locationName,
  capacity,
  locationRating,
  isOnline = false,
  attendeeNames,
  joined = false,
  joining = false,
  accent = false,
  variant = 'full',
  onPress,
  onJoin,
  style,
}: SessionCardProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  const going = session.participantIds.length;
  const isFull =
    session.status === 'full' || (capacity !== undefined && going >= capacity);
  const isCancelled = session.status === 'cancelled';
  const msToStart = session.startTime.toDate().getTime() - Date.now();
  const startingSoon = !isCancelled && msToStart > 0 && msToStart < STARTING_SOON_MS;

  const badge = isCancelled ? (
    <BadgeChip label="Cancelled" tone="neutral" />
  ) : isFull ? (
    <BadgeChip label="Full" tone="neutral" />
  ) : startingSoon ? (
    <BadgeChip label="Starting soon" tone="sunflower" />
  ) : isOnline ? (
    <BadgeChip label="Online" tone="lake" />
  ) : null;

  const placeParts = [
    formatSessionStart(session.startTime),
    isOnline ? 'Online' : locationName,
  ].filter(Boolean);
  const placeLine = placeParts.join(' · ');
  const ratingLine =
    locationRating !== undefined && !isOnline ? ` · ★${locationRating.toFixed(1)}` : '';

  const cardStyle = [
    styles.card,
    {
      backgroundColor: palette.surface,
      borderColor: palette.border,
      opacity: isFull || isCancelled ? 0.6 : 1,
    },
    accent && { borderLeftWidth: 4, borderLeftColor: palette.tint },
    variant === 'compact' && styles.compact,
    style,
  ];

  if (variant === 'compact') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [...cardStyle, pressed && styles.pressed]}>
        <CourseChip code={session.classId} />
        <Text style={[TypeScale.label, styles.title, { color: palette.text }]} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
          {placeLine}
        </Text>
        <SeatPips going={going} capacity={capacity} />
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [...cardStyle, pressed && styles.pressed]}>
      <View style={styles.headerRow}>
        <CourseChip code={session.classId} />
        {badge}
      </View>
      <Text style={[TypeScale.heading, styles.title, { color: palette.text }]} numberOfLines={1}>
        {session.title}
      </Text>
      <Text style={[TypeScale.body, { color: palette.icon }]} numberOfLines={1}>
        {placeLine}
        {ratingLine}
      </Text>
      <View style={styles.footerRow}>
        <View style={styles.pipsBlock}>
          <SeatPips going={going} capacity={capacity} />
          {attendeeNames && attendeeNames.length > 0 ? (
            <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
              {formatAttendees(attendeeNames)}
            </Text>
          ) : null}
        </View>
        {onJoin && !isCancelled ? (
          joined ? (
            <Button label="✓ Going" variant="success" size="sm" onPress={onPress} />
          ) : (
            <Button
              label={isFull ? 'Waitlist' : 'Join'}
              variant={isFull ? 'secondary' : 'primary'}
              size="sm"
              loading={joining}
              onPress={onJoin}
            />
          )
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: Space.lg,
    gap: Space.sm,
  },
  compact: {
    width: 180,
  },
  pressed: {
    opacity: 0.85,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  title: {
    marginTop: Space.xs,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Space.md,
    marginTop: Space.xs,
  },
  pipsBlock: {
    flexShrink: 1,
    gap: Space.xs,
  },
});
