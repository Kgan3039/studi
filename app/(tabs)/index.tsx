import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { logOut, signInOrCreateAccount, subscribeToAuthState } from '../../lib/auth';
import { getUserProfile, updateUserClasses } from '../../lib/firestore';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { User } from 'firebase/auth';

const SUGGESTED_CLASSES = ['CS400', 'CS300', 'MATH221', 'STAT240', 'CHEM103', 'ECON101'];

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [customClass, setCustomClass] = useState('');
  const [authStatus, setAuthStatus] = useState('Checking session...');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isProfileBusy, setIsProfileBusy] = useState(false);
  const [classes, setClasses] = useState<string[]>([]);
  const [classesStatus, setClassesStatus] = useState('Sign in to start adding your classes.');
  const isSignedIn = !!currentUser;

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      if (user?.email) {
        setEmail(user.email);
        setAuthStatus(`Signed in as ${user.email}`);
        return;
      }

      setClasses([]);
      setClassesStatus('Sign in to start adding your classes.');
      setAuthStatus('Not signed in');
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

        setClasses(savedClasses);
        setClassesStatus(
          savedClasses.length > 0
            ? `Saved ${savedClasses.length} class${savedClasses.length === 1 ? '' : 'es'} to your profile.`
            : 'No classes saved yet.'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load your profile.';
        setClassesStatus(message);
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

  async function handleSignIn() {
    try {
      setIsBusy(true);
      const result = await signInOrCreateAccount(email, password);
      setAuthStatus(
        result.mode === 'sign-in'
          ? `Signed in as ${result.user.email}`
          : `Created account for ${result.user.email}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in right now.';
      setAuthStatus(message);
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
      setAuthStatus('Signed out');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign out right now.';
      setAuthStatus(message);
      Alert.alert('Sign Out Error', message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}>
      <ThemedView style={[styles.hero, { backgroundColor: colorScheme === 'dark' ? '#14323b' : '#e8f6fb' }]}>
        <ThemedText type="title" style={styles.heroTitle}>
          Studi
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Find study partners at UW-Madison, compare availability, and start sessions faster.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' }]}>
        <ThemedText type="subtitle">Firebase Status</ThemedText>
        <ThemedText>Firestore rules are active for `users`, `sessions`, and `locations`.</ThemedText>
        <ThemedText>{authStatus}</ThemedText>
      </ThemedView>

      {isSignedIn ? (
        <>
          <ThemedView
            style={[
              styles.card,
              { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
            ]}>
            <ThemedText type="subtitle">Profile Setup</ThemedText>
            <ThemedText style={styles.helperText}>
              You&apos;re signed in. Finish your setup here before moving on to matching and sessions.
            </ThemedText>
            <ThemedText>{classesStatus}</ThemedText>

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
                          : colorScheme === 'dark'
                            ? '#1b252a'
                            : '#f4fafc',
                        borderColor: isSelected
                          ? palette.tint
                          : colorScheme === 'dark'
                            ? '#35515b'
                            : '#c8dbe2',
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
                    borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
                    backgroundColor: colorScheme === 'dark' ? '#1b252a' : '#f4fafc',
                    borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
                    opacity: isProfileBusy ? 0.5 : 1,
                  },
                ]}>
                <ThemedText type="defaultSemiBold">Add</ThemedText>
              </Pressable>
            </View>

            <ThemedText>
              Selected classes: {classes.length > 0 ? classes.join(', ') : 'None yet'}
            </ThemedText>

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

            <Pressable
              disabled={isBusy}
              onPress={handleSignOut}
              style={[
                styles.secondaryButton,
                {
                  borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
                  opacity: isBusy ? 0.5 : 1,
                },
              ]}>
              <ThemedText type="defaultSemiBold">Sign Out</ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView
            style={[
              styles.card,
              { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
            ]}>
            <ThemedText type="subtitle">What This Gives You</ThemedText>
            <ThemedText>
              Authenticated users persist across app restarts on native once AsyncStorage is
              installed.
            </ThemedText>
            <ThemedText>
              Each successful sign-in also creates or updates a Firestore profile in
              `users/{'{uid}'}`.
            </ThemedText>
          </ThemedView>
        </>
      ) : (
        <>
          <ThemedView
            style={[
              styles.card,
              { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
            ]}>
            <ThemedText type="subtitle">UW Email Login</ThemedText>
            <ThemedText style={styles.helperText}>
              Use a `@wisc.edu` email. If the account does not exist yet, the app will create it.
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
                  borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
                  borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
                  color: palette.text,
                },
              ]}
              value={password}
            />

            <View style={styles.actions}>
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
              { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
            ]}>
            <ThemedText type="subtitle">What Happens Next</ThemedText>
            <ThemedText>
              After sign-in, this same Home tab switches into setup mode so you can save classes
              without navigating away from the screens your teammates are building.
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
    padding: 20,
    gap: 16,
  },
  hero: {
    borderRadius: 24,
    padding: 24,
  },
  heroTitle: {
    marginBottom: 12,
  },
  heroText: {
    maxWidth: 420,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  helperText: {
    opacity: 0.8,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actions: {
    gap: 12,
    marginTop: 4,
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
  flexInput: {
    flex: 1,
  },
  inlineButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
});
