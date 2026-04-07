import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import {
  getPotentialMatches,
  type AvailabilityDay,
  type AvailabilitySlot,
  type PotentialMatch,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

function formatTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

function formatDay(day: AvailabilityDay) {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function formatAvailabilitySlot(slot: AvailabilitySlot) {
  return `${formatDay(slot.day)} ${formatTime(slot.startMinutes)}-${formatTime(slot.endMinutes)}`;
}

export default function MatchesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [matches, setMatches] = useState<PotentialMatch[]>([]);
  const [status, setStatus] = useState('Sign in to load your matches.');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  async function loadMatches(userId: string) {
    try {
      setIsLoading(true);
      const loadedMatches = await getPotentialMatches(userId);
      setMatches(loadedMatches);
      setStatus(
        loadedMatches.length > 0
          ? `Found ${loadedMatches.length} potential match${loadedMatches.length === 1 ? '' : 'es'}.`
          : 'No matches yet. Ask more classmates to sign up and save classes + availability.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load matches right now.';
      setStatus(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) {
      setMatches([]);
      setStatus('Sign in to load your matches.');
      setIsLoading(false);
      return;
    }

    loadMatches(currentUser.uid);
  }, [currentUser]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView
        style={[
          styles.hero,
          { backgroundColor: palette.hero },
        ]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Matching</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          Matched Students
        </ThemedText>
        <ThemedText style={styles.heroText}>
          See students who share your classes and have overlapping availability.
        </ThemedText>
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Overview</ThemedText>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: palette.surfaceMuted },
            ]}>
            <ThemedText type="defaultSemiBold">{matches.length} match{matches.length === 1 ? '' : 'es'}</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">Potential study partners</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
        {currentUser ? (
          <Pressable
            onPress={() => loadMatches(currentUser.uid)}
            style={[
              styles.refreshButton,
              {
                borderColor: palette.outline,
                opacity: isLoading ? 0.6 : 1,
              },
            ]}>
            {isLoading ? (
              <ActivityIndicator color={palette.text} />
            ) : (
              <ThemedText type="defaultSemiBold">Refresh Matches</ThemedText>
            )}
          </Pressable>
        ) : null}
      </ThemedView>

      {matches.length > 0 ? (
        matches.map((match) => (
          <ThemedView
            key={match.user.uid}
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Potential match</ThemedText>
            </View>
            <ThemedText type="subtitle">{match.user.displayName || match.user.email}</ThemedText>
            <ThemedText style={styles.statusText}>{match.user.email}</ThemedText>

            <View style={styles.sectionBlock}>
              <ThemedText type="defaultSemiBold">Shared Classes</ThemedText>
              <View style={styles.chipRow}>
                {match.sharedClasses.map((classCode) => (
                  <ThemedView
                    key={`${match.user.uid}-${classCode}`}
                    style={[
                      styles.chip,
                      { backgroundColor: palette.surfaceMuted, borderColor: palette.outline },
                    ]}>
                    <ThemedText type="defaultSemiBold">{classCode}</ThemedText>
                  </ThemedView>
                ))}
              </View>
            </View>

            <View style={styles.sectionBlock}>
              <ThemedText type="defaultSemiBold">Availability Overlap</ThemedText>
              <View style={styles.chipRow}>
                {match.availabilityOverlap.map((slot) => (
                  <ThemedView
                    key={`${match.user.uid}-${slot.day}-${slot.startMinutes}-${slot.endMinutes}`}
                    style={[
                      styles.chip,
                      styles.wideChip,
                      { backgroundColor: palette.surfaceMuted, borderColor: palette.outline },
                    ]}>
                    <ThemedText type="defaultSemiBold">{formatAvailabilitySlot(slot)}</ThemedText>
                  </ThemedView>
                ))}
              </View>
            </View>
          </ThemedView>
        ))
      ) : (
        <ThemedView
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          <ThemedText type="subtitle">No Matches Yet</ThemedText>
          <ThemedText>
            Matches show up after other users save overlapping classes and availability.
          </ThemedText>
        </ThemedView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
  },
  heroTitle: {
    marginBottom: 4,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
    shadowColor: '#082431',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusText: {
    opacity: 0.82,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  sectionBlock: {
    gap: 8,
  },
  wideChip: {
    minHeight: 44,
  },
});
