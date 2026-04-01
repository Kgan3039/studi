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
import { testFirestoreWrite } from '../../lib/testFirebase';
import { logOut, signInOrCreateAccount, subscribeToAuthState } from '../../lib/auth';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { User } from 'firebase/auth';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authStatus, setAuthStatus] = useState('Checking session...');
  const [firestoreStatus, setFirestoreStatus] = useState('Testing Firestore write...');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      if (user?.email) {
        setEmail(user.email);
        setAuthStatus(`Signed in as ${user.email}`);
        return;
      }

      setAuthStatus('Not signed in');
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function runFirestoreTest() {
      const result = await testFirestoreWrite();

      if (result.ok) {
        setFirestoreStatus(
          `Firestore write succeeded. Collection: ${result.collection}, doc ID: ${result.id}`
        );
        return;
      }

      setFirestoreStatus(`Firestore write failed: ${result.error}`);
    }

    runFirestoreTest();
  }, []);

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
        <ThemedText>{firestoreStatus}</ThemedText>
        <ThemedText>{authStatus}</ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' }]}>
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

          <Pressable
            disabled={isBusy || !currentUser}
            onPress={handleSignOut}
            style={[
              styles.secondaryButton,
              {
                borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
                opacity: isBusy || !currentUser ? 0.5 : 1,
              },
            ]}>
            <ThemedText type="defaultSemiBold">Sign Out</ThemedText>
          </Pressable>
        </View>
      </ThemedView>

      <ThemedView style={[styles.card, { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' }]}>
        <ThemedText type="subtitle">What This Gives You</ThemedText>
        <ThemedText>Authenticated users persist across app restarts on native once AsyncStorage is installed.</ThemedText>
        <ThemedText>Each successful sign-in also creates or updates a Firestore profile in `users/{'{uid}'}`.</ThemedText>
      </ThemedView>
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
