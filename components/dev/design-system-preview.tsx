import { Timestamp } from 'firebase/firestore';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SessionCard } from '@/components/session-card';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { SeatPips } from '@/components/ui/SeatPips';
import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Dev-only gallery of the Direction D primitives. Not a route — to view it,
 * temporarily render <DesignSystemPreview /> from any screen while
 * developing. Uses static local data only; no Firestore reads.
 */
export function DesignSystemPreview() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  const inFortyFiveMin = Timestamp.fromDate(new Date(Date.now() + 45 * 60 * 1000));
  const tonight = Timestamp.fromDate(new Date(Date.now() + 6 * 60 * 60 * 1000));
  const end = Timestamp.fromDate(new Date(Date.now() + 8 * 60 * 60 * 1000));

  const baseSession = {
    sessionId: 'preview-1',
    classId: 'CS 354',
    title: 'Midterm 2 grind',
    startTime: inFortyFiveMin,
    endTime: end,
    status: 'open' as const,
    participantIds: ['a', 'b', 'c'],
  };

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}>
      <Text style={[TypeScale.title, { color: palette.text }]}>Direction D</Text>

      <Text style={[TypeScale.heading, { color: palette.text }]}>Buttons</Text>
      <View style={styles.row}>
        <Button label="Join" onPress={() => {}} />
        <Button label="✓ Going" variant="success" onPress={() => {}} />
        <Button label="Waitlist" variant="secondary" onPress={() => {}} />
        <Button label="Leave" variant="ghost" onPress={() => {}} />
        <Button label="Joining" loading onPress={() => {}} />
      </View>

      <Text style={[TypeScale.heading, { color: palette.text }]}>Chips</Text>
      <View style={styles.row}>
        <CourseChip code="CS 354" />
        <CourseChip code="CHEM 103" selected />
        <BadgeChip label="Starting soon" tone="sunflower" />
        <BadgeChip label="Online" tone="lake" />
        <BadgeChip label="Open spots" tone="moss" />
        <BadgeChip label="Full" tone="neutral" />
      </View>

      <Text style={[TypeScale.heading, { color: palette.text }]}>Seat pips</Text>
      <SeatPips going={3} capacity={5} />
      <SeatPips going={5} capacity={5} />
      <SeatPips going={4} />
      <SeatPips going={12} capacity={20} />

      <Text style={[TypeScale.heading, { color: palette.text }]}>Session cards</Text>
      <SessionCard
        session={baseSession}
        locationName="College Library"
        capacity={5}
        locationRating={4.6}
        attendeeNames={['Maya P', 'Jordan K', 'Alex R']}
        accent
        onPress={() => {}}
        onJoin={() => {}}
      />
      <SessionCard
        session={{ ...baseSession, sessionId: 'preview-2', classId: 'CHEM 103', title: 'Problem set 8', startTime: tonight }}
        isOnline
        capacity={6}
        onPress={() => {}}
        onJoin={() => {}}
        joined
      />
      <SessionCard
        session={{ ...baseSession, sessionId: 'preview-3', status: 'full', participantIds: ['a', 'b', 'c', 'd', 'e'] }}
        locationName="Memorial Library"
        capacity={5}
        onPress={() => {}}
        onJoin={() => {}}
      />
      <View style={styles.row}>
        <SessionCard
          session={{ ...baseSession, sessionId: 'preview-4' }}
          locationName="College Library"
          capacity={5}
          variant="compact"
          onPress={() => {}}
        />
        <SessionCard
          session={{ ...baseSession, sessionId: 'preview-5', classId: 'MATH 222', title: 'HW 9 co-work', startTime: tonight, participantIds: ['a', 'b', 'c', 'd'] }}
          capacity={4}
          variant="compact"
          onPress={() => {}}
        />
      </View>

      <Text style={[TypeScale.heading, { color: palette.text }]}>Empty state</Text>
      <EmptyState
        headline="Nothing for your classes yet"
        body="Someone has to set the first table."
        actionLabel="Start a session"
        onAction={() => {}}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Space.lg,
    gap: Space.lg,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    alignItems: 'center',
  },
});
