import type { Timestamp } from 'firebase/firestore';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { SeatPips } from '@/components/ui/SeatPips';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
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
  /** Resolved display name of the host — "Hosted by Maya" row. */
  hostName?: string;
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

/** "4:00–6:00 PM" when the meridiems match, else "11:00 AM–1:00 PM". */
function formatTimeRange(start: Date, end: Date) {
  const startLabel = formatTime(start);
  const endLabel = formatTime(end);
  const [startClock, startMeridiem] = startLabel.split(' ');
  const endMeridiem = endLabel.split(' ')[1];
  return startMeridiem === endMeridiem
    ? `${startClock}–${endLabel}`
    : `${startLabel}–${endLabel}`;
}

function formatDayLabel(start: Date, now: Date) {
  if (start.toDateString() === now.toDateString()) return 'Today';
  if (start.toDateString() === new Date(now.getTime() + DAY_MS).toDateString()) {
    return 'Tomorrow';
  }
  return start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
  const dayLabel = formatDayLabel(start, now);
  const separator = dayLabel.includes(',') ? ' · ' : ' ';
  return `${dayLabel}${separator}${formatTime(start)}`;
}

/**
 * Like formatSessionStart but with the end time as a range:
 * "Today 4:00–6:00 PM". Imminent sessions stay relative ("in 45 min").
 */
export function formatSessionWindow(
  startTime: Timestamp,
  endTime: Timestamp,
  now: Date = new Date()
) {
  const start = startTime.toDate();
  const end = endTime.toDate();
  const diffMs = start.getTime() - now.getTime();

  if (diffMs > 0 && diffMs < STARTING_SOON_MS) {
    return `in ${Math.max(Math.round(diffMs / 60000), 1)} min`;
  }
  if (end.getTime() <= start.getTime()) {
    return formatSessionStart(startTime, now);
  }
  const dayLabel = formatDayLabel(start, now);
  const separator = dayLabel.includes(',') ? ' · ' : ' ';
  return `${dayLabel}${separator}${formatTimeRange(start, end)}`;
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
  hostName,
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
  const isDark = colorScheme === 'dark';

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

  const timeLine = formatSessionWindow(session.startTime, session.endTime);
  const placeParts = [
    isOnline ? 'Online' : locationName,
    locationRating !== undefined && !isOnline ? `★ ${locationRating.toFixed(1)}` : undefined,
  ].filter(Boolean);
  const placeLine = placeParts.join('  ·  ');

  const hostFirstName = hostName?.trim().split(' ')[0];
  const hostInitial = hostFirstName?.charAt(0).toUpperCase();
  const hostAvatarColors = isDark
    ? { backgroundColor: `${palette.tint}33`, color: palette.tint }
    : { backgroundColor: Brand.red100, color: Brand.red700 };

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
        <Text style={[TypeScale.label, styles.compactTitle, { color: palette.text }]} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={[styles.compactTime, { color: palette.text }]} numberOfLines={1}>
          {timeLine}
        </Text>
        {placeLine ? (
          <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
            {placeLine}
          </Text>
        ) : null}
        <SeatPips going={going} capacity={capacity} style={styles.compactPips} />
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
      <View style={styles.metaBlock}>
        <Text style={[styles.timeText, { color: palette.text }]} numberOfLines={1}>
          {timeLine}
        </Text>
        {placeLine ? (
          <Text style={[styles.placeText, { color: palette.icon }]} numberOfLines={1}>
            {placeLine}
          </Text>
        ) : null}
      </View>
      <View style={[styles.divider, { backgroundColor: palette.border }]} />
      <View style={styles.footerRow}>
        <View style={styles.peopleBlock}>
          <SeatPips going={going} capacity={capacity} />
          {attendeeNames && attendeeNames.length > 0 ? (
            <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
              {formatAttendees(attendeeNames)}
            </Text>
          ) : null}
          {hostFirstName ? (
            <View style={styles.hostRow}>
              <View style={[styles.hostAvatar, { backgroundColor: hostAvatarColors.backgroundColor }]}>
                <Text style={[styles.hostInitial, { color: hostAvatarColors.color }]}>
                  {hostInitial}
                </Text>
              </View>
              <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
                Hosted by {hostFirstName}
              </Text>
            </View>
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
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md + 2,
    shadowColor: Brand.charcoal900,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
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
    marginTop: Space.sm,
  },
  metaBlock: {
    marginTop: Space.xs,
    gap: 2,
  },
  timeText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  placeText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Space.md - 2,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  peopleBlock: {
    flexShrink: 1,
    gap: Space.xs + 1,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs + 2,
  },
  hostAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostInitial: {
    fontFamily: FontFamily.code,
    fontSize: 10,
    lineHeight: 13,
  },
  compactTitle: {
    marginTop: Space.sm,
  },
  compactTime: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  compactPips: {
    marginTop: Space.sm,
  },
});
