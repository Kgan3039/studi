import type { Timestamp } from 'firebase/firestore';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Avatar, AvatarStack } from '@/components/ui/Avatar';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { SeatPips } from '@/components/ui/SeatPips';
import {
  Colors,
  deptColorFor,
  Elevation,
  FontFamily,
  Radius,
  Space,
  TypeScale,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { StudySession } from '@/lib/firestore';

/**
 * The fields the card actually reads — a subset of StudySession so both
 * screen view models (SessionListEntry, StudySessionListItem) satisfy it.
 */
export type SessionCardSession = Pick<
  StudySession,
  | 'sessionId'
  | 'classId'
  | 'title'
  | 'startTime'
  | 'endTime'
  | 'status'
  | 'participantIds'
  | 'capacity'
>;

export type SessionCardProps = {
  session: SessionCardSession;
  /** Resolved display name of the location; falls back to nothing shown. */
  locationName?: string;
  /** Overrides session.capacity when provided; pre-capacity sessions have neither. */
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
  /** Legacy accent prop — hero variant supersedes it; kept for callers. */
  accent?: boolean;
  /**
   * Handoff variants (§2): hero = dept-tinted header + serif title;
   * full = standard card; compact = small card for rails; list = dense row.
   */
  variant?: 'hero' | 'full' | 'compact' | 'list';
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
 * Relative when close: "in 45 min", "Today 4:00 PM", "Tomorrow 10:00 AM",
 * then "Mon, Jun 15 · 4:00 PM".
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
 * The core session component (handoff §2 SessionCard).
 * Anatomy: dept course chip first, one-line title, time + place, going
 * count, one primary action.
 */
export function SessionCard({
  session,
  locationName,
  capacity: capacityProp,
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

  const capacity = capacityProp ?? session.capacity;
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
    <BadgeChip label="Starting soon" tone="now" />
  ) : isOnline ? (
    <BadgeChip label="Online" tone="info" />
  ) : null;

  const timeLine = formatSessionWindow(session.startTime, session.endTime);
  const placeParts = [
    isOnline ? 'Online' : locationName,
    locationRating !== undefined && !isOnline ? `★ ${locationRating.toFixed(1)}` : undefined,
  ].filter(Boolean);
  const metaLine = [timeLine, ...placeParts].join(' · ');

  const dept = deptColorFor(session.classId) ?? palette.text;
  const hostFirstName = hostName?.trim().split(' ')[0];
  const spotsLeft = capacity !== undefined ? Math.max(capacity - going, 0) : undefined;
  // "3 of 8 going" with capacity, "Full" when no seats remain, plain count otherwise.
  const goingLabel =
    spotsLeft === 0 ? 'Full' : capacity !== undefined ? `${going} of ${capacity} going` : `${going} going`;

  const dimmed = isFull || isCancelled;

  const joinAction =
    onJoin && !isCancelled ? (
      joined ? (
        <Button label="✓ Going" variant="success" size="sm" onPress={onPress} />
      ) : (
        <Button
          label="Join"
          variant={isFull ? 'secondary' : 'primary'}
          size="sm"
          loading={joining}
          disabled={isFull}
          onPress={onJoin}
        />
      )
    ) : null;

  /* ---- list row (browse results) ---- */
  if (variant === 'list') {
    const [deptCode, ...numberParts] = session.classId.trim().split(/\s+/);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.listRow,
          { opacity: dimmed ? 0.6 : pressed ? 0.8 : 1 },
          style,
        ]}>
        <View
          style={[
            styles.deptTile,
            {
              backgroundColor: isDark ? `${dept}33` : `${dept}1A`,
              borderColor: isDark ? `${dept}4D` : `${dept}33`,
            },
          ]}>
          <Text style={[styles.deptTileCode, { color: isDark ? palette.text : dept }]} numberOfLines={1}>
            {deptCode}
          </Text>
          <Text style={[styles.deptTileNumber, { color: isDark ? palette.text : dept }]} numberOfLines={1}>
            {numberParts.join(' ') || '—'}
          </Text>
        </View>
        <View style={styles.listBody}>
          <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
            {session.title}
          </Text>
          <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
            {metaLine}
          </Text>
        </View>
        <Text style={[TypeScale.meta, { color: palette.icon }]}>{goingLabel}</Text>
      </Pressable>
    );
  }

  /* ---- compact rail card ---- */
  if (variant === 'compact') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          styles.compact,
          Elevation.e1,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            opacity: dimmed ? 0.6 : pressed ? 0.85 : 1,
          },
          style,
        ]}>
        <CourseChip code={session.classId} size="sm" />
        <Text style={[TypeScale.label, styles.compactTitle, { color: palette.text }]} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
          {timeLine}
        </Text>
        {placeParts.length > 0 ? (
          <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
            {placeParts.join(' · ')}
          </Text>
        ) : null}
        <SeatPips going={going} capacity={capacity} style={styles.compactPips} />
      </Pressable>
    );
  }

  /* ---- hero card (Today "next session") ---- */
  if (variant === 'hero') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          styles.heroCard,
          Elevation.e1,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            opacity: dimmed ? 0.6 : pressed ? 0.9 : 1,
          },
          style,
        ]}>
        <View
          style={[
            styles.heroStrip,
            { backgroundColor: isDark ? `${dept}26` : `${dept}14` },
          ]}>
          <CourseChip code={session.classId} size="md" />
          {badge}
        </View>
        <View style={styles.heroBody}>
          <Text style={[styles.heroTitle, { color: palette.text }]} numberOfLines={2}>
            {session.title}
          </Text>
          <Text style={[TypeScale.body, styles.heroMeta, { color: palette.icon }]} numberOfLines={1}>
            {metaLine}
          </Text>
          <View style={styles.heroFooter}>
            {attendeeNames && attendeeNames.length > 0 ? (
              <AvatarStack names={attendeeNames} totalCount={going} size="sm" />
            ) : hostFirstName ? (
              <View style={styles.hostRow}>
                <Avatar name={hostName ?? 'Student'} size="sm" verified />
                <Text style={[TypeScale.meta, { color: palette.icon }]} numberOfLines={1}>
                  Hosted by{' '}
                  <Text style={{ color: palette.text, fontFamily: FontFamily.bodySemiBold }}>
                    {hostFirstName}
                  </Text>
                </Text>
              </View>
            ) : (
              <SeatPips going={going} capacity={capacity} />
            )}
            {joinAction ?? (
              <Text style={[TypeScale.meta, { color: palette.icon }]}>{goingLabel}</Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  /* ---- full card (default) ---- */
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        styles.fullCard,
        Elevation.e1,
        accent && { borderLeftWidth: 3, borderLeftColor: palette.tint },
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          opacity: dimmed ? 0.6 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      <View style={styles.headerRow}>
        <CourseChip code={session.classId} size="sm" />
        {badge}
      </View>
      <Text style={[TypeScale.bodyStrong, styles.title, { color: palette.text }]} numberOfLines={1}>
        {session.title}
      </Text>
      <Text style={[TypeScale.caption, styles.metaText, { color: palette.icon }]} numberOfLines={1}>
        {metaLine}
      </Text>
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
              <Avatar name={hostName ?? 'Student'} size="xs" />
              <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
                Hosted by {hostFirstName}
              </Text>
            </View>
          ) : null}
        </View>
        {joinAction}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  fullCard: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.lg - 2,
  },
  compact: {
    width: 180,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.md,
    gap: 3,
  },
  heroCard: {
    borderRadius: Radius.xxl - 4,
    overflow: 'hidden',
  },
  heroStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    paddingHorizontal: Space.lg + 4,
    paddingVertical: Space.md + 2,
  },
  heroBody: {
    paddingHorizontal: Space.lg + 4,
    paddingVertical: Space.lg + 2,
  },
  heroTitle: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 26,
    lineHeight: 31,
  },
  heroMeta: {
    marginTop: Space.sm,
  },
  heroFooter: {
    marginTop: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  title: {
    marginTop: Space.sm + 2,
  },
  metaText: {
    marginTop: Space.xs,
  },
  footerRow: {
    marginTop: Space.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
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
    gap: Space.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.xs,
  },
  deptTile: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  deptTileCode: {
    fontFamily: FontFamily.code,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.8,
  },
  deptTileNumber: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 14,
    lineHeight: 17,
  },
  listBody: {
    flex: 1,
    gap: 2,
  },
  compactTitle: {
    marginTop: Space.sm - 2,
  },
  compactPips: {
    marginTop: Space.sm - 2,
  },
});
