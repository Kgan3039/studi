import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { logOut, subscribeToAuthState } from '@/lib/auth';
import {
  getUserProfile,
  updateUserAvailability,
  updateUserClasses,
  updateUserDisplayName,
  type AvailabilityDay,
  type AvailabilitySlot,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

const SUGGESTED_CLASSES = ['CS400', 'CS300', 'MATH221', 'STAT240', 'CHEM103', 'ECON101'];
const SUGGESTED_AVAILABILITY: AvailabilitySlot[] = [
  { day: 'mon', startMinutes: 1080, endMinutes: 1200 },
  { day: 'tue', startMinutes: 960, endMinutes: 1080 },
  { day: 'wed', startMinutes: 1140, endMinutes: 1260 },
  { day: 'thu', startMinutes: 900, endMinutes: 1020 },
  { day: 'fri', startMinutes: 780, endMinutes: 900 },
];

function splitDisplayName(displayName: string | undefined) {
  const normalized = displayName?.trim() ?? '';

  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const [firstName, ...rest] = normalized.split(/\s+/);
  return {
    firstName,
    lastName: rest.join(' '),
  };
}

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

function isSameSlot(first: AvailabilitySlot, second: AvailabilitySlot) {
  return (
    first.day === second.day &&
    first.startMinutes === second.startMinutes &&
    first.endMinutes === second.endMinutes
  );
}

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [customClass, setCustomClass] = useState('');
  const [classes, setClasses] = useState<string[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [nameStatus, setNameStatus] = useState('Save your name so Studi looks more personal.');
  const [classesStatus, setClassesStatus] = useState('Update the classes you want to match on.');
  const [availabilityStatus, setAvailabilityStatus] = useState(
    'Update the time blocks when you are usually free.'
  );

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadProfile() {
      if (!currentUser) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const profile = await getUserProfile(currentUser.uid);
        const savedName = splitDisplayName(profile?.displayName);
        const savedClasses = profile?.classes ?? [];
        const savedAvailability = profile?.availability ?? [];

        setFirstName(savedName.firstName);
        setLastName(savedName.lastName);
        setClasses(savedClasses);
        setAvailability(savedAvailability);
        setNameStatus(
          profile?.displayName
            ? `Profile name saved as ${profile.displayName}.`
            : 'Add your first and last name to personalize Studi.'
        );
        setClassesStatus(
          savedClasses.length > 0
            ? `You are matching on ${savedClasses.length} class${
                savedClasses.length === 1 ? '' : 'es'
              }.`
            : 'No classes saved yet.'
        );
        setAvailabilityStatus(
          savedAvailability.length > 0
            ? `You have ${savedAvailability.length} saved availability slot${
                savedAvailability.length === 1 ? '' : 's'
              }.`
            : 'No availability saved yet.'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load your profile.';
        setNameStatus(message);
        setClassesStatus(message);
        setAvailabilityStatus(message);
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile();
  }, [currentUser]);

  function toggleClassSelection(classCode: string) {
    setClasses((currentClasses) =>
      currentClasses.includes(classCode)
        ? currentClasses.filter((selectedClass) => selectedClass !== classCode)
        : [...currentClasses, classCode]
    );
  }

  function handleAddCustomClass() {
    const normalizedClass = customClass.trim().toUpperCase();

    if (!normalizedClass) {
      return;
    }

    setClasses((currentClasses) =>
      currentClasses.includes(normalizedClass)
        ? currentClasses
        : [...currentClasses, normalizedClass]
    );
    setCustomClass('');
  }

  function toggleAvailabilitySlot(slot: AvailabilitySlot) {
    setAvailability((currentAvailability) =>
      currentAvailability.some((savedSlot) => isSameSlot(savedSlot, slot))
        ? currentAvailability.filter((savedSlot) => !isSameSlot(savedSlot, slot))
        : [...currentAvailability, slot]
    );
  }

  async function handleSaveName() {
    if (!currentUser) {
      return;
    }

    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();

    if (!firstName.trim() || !lastName.trim()) {
      setNameStatus('Enter both your first and last name.');
      Alert.alert('Name Error', 'Please enter both your first and last name.');
      return;
    }

    try {
      setIsSaving(true);
      await updateUserDisplayName(currentUser.uid, displayName);
      setNameStatus(`Profile name saved as ${displayName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save your name right now.';
      setNameStatus(message);
      Alert.alert('Name Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveClasses() {
    if (!currentUser) {
      return;
    }

    try {
      setIsSaving(true);
      await updateUserClasses(currentUser.uid, classes);
      setClassesStatus(
        classes.length > 0
          ? `You are matching on ${classes.length} class${classes.length === 1 ? '' : 'es'}.`
          : 'No classes saved yet.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save classes right now.';
      setClassesStatus(message);
      Alert.alert('Classes Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveAvailability() {
    if (!currentUser) {
      return;
    }

    try {
      setIsSaving(true);
      await updateUserAvailability(currentUser.uid, availability);
      setAvailabilityStatus(
        availability.length > 0
          ? `You have ${availability.length} saved availability slot${
              availability.length === 1 ? '' : 's'
            }.`
          : 'No availability saved yet.'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save availability right now.';
      setAvailabilityStatus(message);
      Alert.alert('Availability Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSignOut() {
    try {
      setIsSaving(true);
      await logOut();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign out right now.';
      Alert.alert('Sign Out Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  if (!currentUser && !isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: palette.background }]}>
        <ThemedText type="subtitle">Sign in to view your profile</ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.surface }]}>
        <Image
          contentFit="contain"
          source={require('../../assets/images/studi-wordmark.png')}
          style={styles.heroLogo}
        />
        <ThemedText style={[styles.eyebrow, styles.heroEyebrow, { color: palette.tint }]}>
          Your Studi profile
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Keep your name, classes, and availability up to date so matching and sessions stay
          useful.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Account</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: palette.badge }]}>
            <ThemedText type="defaultSemiBold">Signed in</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">{currentUser?.email ?? 'UW account'}</ThemedText>
        <ThemedText style={styles.mutedText}>
          This is the email tied to your Firebase account.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Name</ThemedText>
        </View>
        <ThemedText type="subtitle">How your name appears</ThemedText>
        <ThemedText style={styles.statusCopy}>{nameStatus}</ThemedText>
        <View style={styles.inlineRow}>
          <TextInput
            autoCapitalize="words"
            editable={!isSaving}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[styles.input, styles.flexInput, { borderColor: palette.outline, color: palette.text }]}
            value={firstName}
          />
          <TextInput
            autoCapitalize="words"
            editable={!isSaving}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[styles.input, styles.flexInput, { borderColor: palette.outline, color: palette.text }]}
            value={lastName}
          />
        </View>
        <Pressable
          disabled={isSaving}
          onPress={handleSaveName}
          style={[styles.secondaryButton, { borderColor: palette.outline, opacity: isSaving ? 0.6 : 1 }]}>
          <ThemedText type="defaultSemiBold">Save Name</ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Classes</ThemedText>
        <ThemedText type="subtitle">Courses you want to match on</ThemedText>
        <ThemedText style={styles.statusCopy}>{classesStatus}</ThemedText>
        <View style={styles.chipRow}>
          {SUGGESTED_CLASSES.map((classCode) => {
            const isSelected = classes.includes(classCode);

            return (
              <Pressable
                key={classCode}
                disabled={isSaving}
                onPress={() => toggleClassSelection(classCode)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                    borderColor: isSelected ? palette.tint : palette.outline,
                    opacity: isSaving ? 0.5 : 1,
                  },
                ]}>
                <ThemedText
                  type="defaultSemiBold"
                  lightColor={isSelected ? '#ffffff' : undefined}
                  darkColor={isSelected ? '#ffffff' : undefined}>
                  {classCode}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.inlineRow}>
          <TextInput
            autoCapitalize="characters"
            editable={!isSaving}
            onChangeText={setCustomClass}
            placeholder="Add custom class"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[styles.input, styles.flexInput, { borderColor: palette.outline, color: palette.text }]}
            value={customClass}
          />
          <Pressable
            disabled={isSaving}
            onPress={handleAddCustomClass}
            style={[
              styles.inlineButton,
              {
                backgroundColor: palette.surfaceMuted,
                borderColor: palette.outline,
                opacity: isSaving ? 0.5 : 1,
              },
            ]}>
            <ThemedText type="defaultSemiBold">Add</ThemedText>
          </Pressable>
        </View>
        <Pressable
          disabled={isSaving}
          onPress={handleSaveClasses}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isSaving ? 0.6 : 1 }]}>
          <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
            Save Classes
          </ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Availability</ThemedText>
        <ThemedText type="subtitle">When you are usually free</ThemedText>
        <ThemedText style={styles.statusCopy}>{availabilityStatus}</ThemedText>
        <View style={styles.chipRow}>
          {SUGGESTED_AVAILABILITY.map((slot) => {
            const isSelected = availability.some((savedSlot) => isSameSlot(savedSlot, slot));

            return (
              <Pressable
                key={`${slot.day}-${slot.startMinutes}-${slot.endMinutes}`}
                disabled={isSaving}
                onPress={() => toggleAvailabilitySlot(slot)}
                style={[
                  styles.chip,
                  styles.wideChip,
                  {
                    backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                    borderColor: isSelected ? palette.tint : palette.outline,
                    opacity: isSaving ? 0.5 : 1,
                  },
                ]}>
                <ThemedText
                  type="defaultSemiBold"
                  lightColor={isSelected ? '#ffffff' : undefined}
                  darkColor={isSelected ? '#ffffff' : undefined}>
                  {formatAvailabilitySlot(slot)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          disabled={isSaving}
          onPress={handleSaveAvailability}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isSaving ? 0.6 : 1 }]}>
          <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
            Save Availability
          </ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Account actions</ThemedText>
        <ThemedText type="subtitle">Manage your session</ThemedText>
        <Pressable
          disabled={isSaving}
          onPress={handleSignOut}
          style={[styles.secondaryButton, { borderColor: palette.outline, opacity: isSaving ? 0.6 : 1 }]}>
          {isSaving ? (
            <ActivityIndicator color={palette.text} />
          ) : (
            <ThemedText type="defaultSemiBold">Sign Out</ThemedText>
          )}
        </Pressable>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  screen: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    alignItems: 'center',
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  heroLogo: {
    height: 96,
    width: 300,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroEyebrow: {
    textAlign: 'center',
  },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
    textAlign: 'center',
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
  statusCopy: {
    opacity: 0.8,
  },
  mutedText: {
    opacity: 0.8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  wideChip: {
    minHeight: 48,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  flexInput: {
    flex: 1,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inlineButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
});
