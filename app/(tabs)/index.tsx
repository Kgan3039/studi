import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
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
import {
  logOut,
  signInOrPrepareAccountCreation,
  subscribeToAuthState,
} from '../../lib/auth';
import {
  getUserProfile,
  updateUserDisplayName,
  updateUserAvailability,
  updateUserClasses,
  type AvailabilityDay,
  type AvailabilitySlot,
} from '../../lib/firestore';
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

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [customClass, setCustomClass] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isProfileBusy, setIsProfileBusy] = useState(false);
  const [classes, setClasses] = useState<string[]>([]);
  const [classesStatus, setClassesStatus] = useState('Sign in to start adding your classes.');
  const [nameStatus, setNameStatus] = useState('Add your first and last name to personalize Studi.');
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [availabilityStatus, setAvailabilityStatus] = useState(
    'Sign in to start adding your availability.'
  );
  const isSignedIn = !!currentUser;

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      if (user?.email) {
        setEmail(user.email);
        return;
      }

      setClasses([]);
      setClassesStatus('Sign in to start adding your classes.');
      setNameStatus('Add your first and last name to personalize Studi.');
      setAvailability([]);
      setAvailabilityStatus('Sign in to start adding your availability.');
      setFirstName('');
      setLastName('');
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadUserProfile() {
      if (!currentUser) {
        return;
      }

      try {
        setIsProfileBusy(true);
        const profile = await getUserProfile(currentUser.uid);
        const savedClasses = profile?.classes ?? [];
        const savedAvailability = profile?.availability ?? [];
        const savedName = splitDisplayName(profile?.displayName);

        setClasses(savedClasses);
        setFirstName(savedName.firstName);
        setLastName(savedName.lastName);
        setNameStatus(
          profile?.displayName
            ? `Profile name saved as ${profile.displayName}.`
            : 'Add your first and last name to personalize Studi.'
        );
        setClassesStatus(
          savedClasses.length > 0
            ? `Saved ${savedClasses.length} class${savedClasses.length === 1 ? '' : 'es'} to your profile.`
            : 'No classes saved yet.'
        );
        setAvailability(savedAvailability);
        setAvailabilityStatus(
          savedAvailability.length > 0
            ? `Saved ${savedAvailability.length} availability slot${
                savedAvailability.length === 1 ? '' : 's'
              } to your profile.`
            : 'No availability saved yet.'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load your profile.';
        setNameStatus(message);
        setClassesStatus(message);
        setAvailabilityStatus(message);
      } finally {
        setIsProfileBusy(false);
      }
    }

    loadUserProfile();
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

  function toggleAvailabilitySlot(slot: AvailabilitySlot) {
    setAvailability((currentAvailability) =>
      currentAvailability.some((savedSlot) => isSameSlot(savedSlot, slot))
        ? currentAvailability.filter((savedSlot) => !isSameSlot(savedSlot, slot))
        : [...currentAvailability, slot]
    );
  }

  async function handleSaveClasses() {
    if (!currentUser) {
      setClassesStatus('Sign in before saving classes.');
      return;
    }

    try {
      setIsProfileBusy(true);
      await updateUserClasses(currentUser.uid, classes);
      setClassesStatus(
        classes.length > 0
          ? `Saved ${classes.length} class${classes.length === 1 ? '' : 'es'} to your profile.`
          : 'Cleared classes from your profile.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save classes right now.';
      setClassesStatus(message);
      Alert.alert('Classes Error', message);
    } finally {
      setIsProfileBusy(false);
    }
  }

  async function handleSaveDisplayName() {
    if (!currentUser) {
      setNameStatus('Sign in before saving your name.');
      return;
    }

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

    if (!firstName.trim() || !lastName.trim()) {
      setNameStatus('Enter both your first and last name.');
      Alert.alert('Name Error', 'Please enter both your first and last name.');
      return;
    }

    try {
      setIsProfileBusy(true);
      await updateUserDisplayName(currentUser.uid, fullName);
      setNameStatus(`Profile name saved as ${fullName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save your name right now.';
      setNameStatus(message);
      Alert.alert('Name Error', message);
    } finally {
      setIsProfileBusy(false);
    }
  }

  async function handleSaveAvailability() {
    if (!currentUser) {
      setAvailabilityStatus('Sign in before saving availability.');
      return;
    }

    try {
      setIsProfileBusy(true);
      await updateUserAvailability(currentUser.uid, availability);
      setAvailabilityStatus(
        availability.length > 0
          ? `Saved ${availability.length} availability slot${
              availability.length === 1 ? '' : 's'
            } to your profile.`
          : 'Cleared availability from your profile.'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save availability right now.';
      setAvailabilityStatus(message);
      Alert.alert('Availability Error', message);
    } finally {
      setIsProfileBusy(false);
    }
  }

  async function handleSignIn() {
    try {
      setIsBusy(true);
      const result = await signInOrPrepareAccountCreation(email, password);

      if (result.mode === 'needs-profile') {
        router.push('/complete-profile');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in right now.';
      Alert.alert('Auth Error', message);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      setIsBusy(true);
      await logOut();
      setPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign out right now.';
      Alert.alert('Sign Out Error', message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView
        style={[
          styles.hero,
          { backgroundColor: palette.surface },
        ]}>
        <Image
          contentFit="contain"
          source={require('../../assets/images/studi-wordmark.png')}
          style={styles.heroLogo}
        />
        <ThemedText style={[styles.eyebrow, styles.heroEyebrow, { color: palette.tint }]}>
          UW-Madison Study Hub
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Find study partners, compare availability, and lock in study sessions without bouncing
          between five different group chats.
        </ThemedText>
      </ThemedView>

      {isSignedIn ? (
        <>
          <ThemedView
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Onboarding</ThemedText>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: palette.badge },
                ]}>
                <ThemedText type="defaultSemiBold">Step 1</ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">Build your study profile</ThemedText>
            <ThemedText style={styles.helperText}>
              Choose the courses Studi should use when matching you with potential partners.
            </ThemedText>
            <ThemedText style={styles.statusCopy}>{nameStatus}</ThemedText>

            <View style={styles.inlineRow}>
              <TextInput
                autoCapitalize="words"
                editable={!isProfileBusy}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
                style={[
                  styles.input,
                  styles.flexInput,
                  {
                    borderColor: palette.outline,
                    color: palette.text,
                    opacity: isProfileBusy ? 0.5 : 1,
                  },
                ]}
                value={firstName}
              />

              <TextInput
                autoCapitalize="words"
                editable={!isProfileBusy}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
                style={[
                  styles.input,
                  styles.flexInput,
                  {
                    borderColor: palette.outline,
                    color: palette.text,
                    opacity: isProfileBusy ? 0.5 : 1,
                  },
                ]}
                value={lastName}
              />
            </View>

            <Pressable
              disabled={isProfileBusy}
              onPress={handleSaveDisplayName}
              style={[
                styles.secondaryButton,
                { borderColor: palette.outline, opacity: isProfileBusy ? 0.5 : 1 },
              ]}>
              <ThemedText type="defaultSemiBold">Save Name</ThemedText>
            </Pressable>
            <ThemedText style={styles.statusCopy}>{classesStatus}</ThemedText>

            <View style={styles.chipRow}>
              {SUGGESTED_CLASSES.map((classCode) => {
                const isSelected = classes.includes(classCode);

                return (
                  <Pressable
                    key={classCode}
                    disabled={isProfileBusy}
                    onPress={() => toggleClassSelection(classCode)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: isSelected
                          ? palette.tint
                          : palette.surfaceMuted,
                        borderColor: isSelected
                          ? palette.tint
                          : palette.outline,
                        opacity: isProfileBusy ? 0.5 : 1,
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
                editable={!isProfileBusy}
                onChangeText={setCustomClass}
                placeholder="Add custom class"
                placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
                style={[
                  styles.input,
                  styles.flexInput,
                  {
                    borderColor: palette.outline,
                    color: palette.text,
                    opacity: isProfileBusy ? 0.5 : 1,
                  },
                ]}
                value={customClass}
              />

              <Pressable
                disabled={isProfileBusy}
                onPress={handleAddCustomClass}
                style={[
                  styles.inlineButton,
                  {
                    backgroundColor: palette.surfaceMuted,
                    borderColor: palette.outline,
                    opacity: isProfileBusy ? 0.5 : 1,
                  },
                ]}>
                <ThemedText type="defaultSemiBold">Add</ThemedText>
              </Pressable>
            </View>

            <ThemedText style={styles.mutedText}>
              Selected classes: {classes.length > 0 ? classes.join(', ') : 'None yet'}
            </ThemedText>

            <View style={styles.buttonColumn}>
              <Pressable
                disabled={isProfileBusy}
                onPress={handleSaveClasses}
                style={[
                  styles.primaryButton,
                  { backgroundColor: palette.tint, opacity: isProfileBusy ? 0.5 : 1 },
                ]}>
                {isProfileBusy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                    Save Classes
                  </ThemedText>
                )}
              </Pressable>

              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => router.push('/matches')}
                  style={[
                    styles.secondaryButton,
                    styles.flexButton,
                    {
                      borderColor: palette.outline,
                    },
                  ]}>
                  <ThemedText type="defaultSemiBold">View Matches</ThemedText>
                </Pressable>

                <Pressable
                  disabled={isBusy}
                  onPress={handleSignOut}
                  style={[
                    styles.secondaryButton,
                    styles.flexButton,
                    {
                      borderColor: palette.outline,
                      opacity: isBusy ? 0.5 : 1,
                    },
                  ]}>
                  <ThemedText type="defaultSemiBold">Sign Out</ThemedText>
                </Pressable>
              </View>
            </View>
          </ThemedView>

          <ThemedView
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Onboarding</ThemedText>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: palette.badge },
                ]}>
                <ThemedText type="defaultSemiBold">Step 2</ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">Set your weekly windows</ThemedText>
            <ThemedText style={styles.helperText}>
              Save a few common study blocks so Studi can find classmates who are free at the same
              time.
            </ThemedText>
            <ThemedText style={styles.statusCopy}>{availabilityStatus}</ThemedText>

            <View style={styles.chipRow}>
              {SUGGESTED_AVAILABILITY.map((slot) => {
                const isSelected = availability.some((savedSlot) => isSameSlot(savedSlot, slot));

                return (
                  <Pressable
                    key={`${slot.day}-${slot.startMinutes}-${slot.endMinutes}`}
                    disabled={isProfileBusy}
                    onPress={() => toggleAvailabilitySlot(slot)}
                    style={[
                      styles.chip,
                      styles.wideChip,
                      {
                        backgroundColor: isSelected
                          ? palette.tint
                          : palette.surfaceMuted,
                        borderColor: isSelected
                          ? palette.tint
                          : palette.outline,
                        opacity: isProfileBusy ? 0.5 : 1,
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

            <ThemedText style={styles.mutedText}>
              Selected availability:{' '}
              {availability.length > 0
                ? availability.map((slot) => formatAvailabilitySlot(slot)).join(', ')
                : 'None yet'}
            </ThemedText>

            <Pressable
              disabled={isProfileBusy}
              onPress={handleSaveAvailability}
              style={[
                styles.primaryButton,
                { backgroundColor: palette.tint, opacity: isProfileBusy ? 0.5 : 1 },
              ]}>
              {isProfileBusy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                  Save Availability
                </ThemedText>
              )}
            </Pressable>
          </ThemedView>

          <ThemedView
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Ready to use</ThemedText>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: palette.surfaceMuted },
                ]}>
                <ThemedText type="defaultSemiBold">Next up</ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">Once setup is saved, you can:</ThemedText>
            <ThemedText style={styles.mutedText}>
              Browse study locations, create sessions, join sessions, and check who else is free
              for your classes.
            </ThemedText>
          </ThemedView>
        </>
      ) : (
        <>
          <ThemedView
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Welcome</ThemedText>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: palette.badge },
                ]}>
                <ThemedText type="defaultSemiBold">Start here</ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">Sign in with your UW email</ThemedText>
            <ThemedText style={styles.helperText}>
              Use a `@wisc.edu` email. If the account does not exist yet, we&apos;ll take you to a
              quick profile setup screen to finish creating it.
            </ThemedText>

            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="netid@wisc.edu"
              placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
              style={[
                styles.input,
                {
                  borderColor: palette.outline,
                  color: palette.text,
                },
              ]}
              value={email}
            />

            <TextInput
              autoCapitalize="none"
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
              secureTextEntry
              style={[
                styles.input,
                {
                  borderColor: palette.outline,
                  color: palette.text,
                },
              ]}
              value={password}
            />

            <View style={styles.buttonColumn}>
              <Pressable
                disabled={isBusy}
                onPress={handleSignIn}
                style={[
                  styles.primaryButton,
                  { backgroundColor: palette.tint, opacity: isBusy ? 0.7 : 1 },
                ]}>
                {isBusy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                    Sign In / Create Account
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </ThemedView>

          <ThemedView
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>What happens next</ThemedText>
            </View>
            <ThemedText type="subtitle">One screen, then setup</ThemedText>
            <ThemedText style={styles.mutedText}>
              After sign-in, this Home tab switches into setup mode so you can save classes and
              availability without jumping into unfinished navigation.
            </ThemedText>
          </ThemedView>
        </>
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
    alignItems: 'center',
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  heroLogo: {
    height: 110,
    width: 320,
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
    lineHeight: 32,
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
  helperText: {
    lineHeight: 30,
    opacity: 0.82,
  },
  mutedText: {
    opacity: 0.8,
  },
  statusCopy: {
    opacity: 0.8,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  flexInput: {
    flex: 1,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  inlineButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  buttonColumn: {
    gap: 12,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  flexButton: {
    flex: 1,
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
