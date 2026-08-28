import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedColorScheme = 'light' | 'dark';

const THEME_PREFERENCE_STORAGE_KEY = '@studi/theme-preference';

type ThemePreferencesContextValue = {
  isLoaded: boolean;
  preference: ThemePreference;
  colorScheme: ResolvedColorScheme;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const ThemePreferencesContext = createContext<ThemePreferencesContextValue | null>(null);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useSystemColorScheme() === 'dark' ? 'dark' : 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [isLoaded, setIsLoaded] = useState(false);
  const persistedPreferenceRef = useRef<ThemePreference>('system');
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestWriteIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)
      .then((storedPreference) => {
        if (!active) {
          return;
        }

        if (isThemePreference(storedPreference)) {
          persistedPreferenceRef.current = storedPreference;
          setPreferenceState(storedPreference);
        }
        setIsLoaded(true);
      })
      .catch(() => {
        if (active) {
          setIsLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<ThemePreferencesContextValue>(
    () => ({
      colorScheme: preference === 'system' ? systemColorScheme : preference,
      isLoaded,
      preference,
      setPreference: async (nextPreference) => {
        const writeId = latestWriteIdRef.current + 1;
        latestWriteIdRef.current = writeId;
        setPreferenceState(nextPreference);

        const write = writeQueueRef.current
          .catch(() => undefined)
          .then(async () => {
            await AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, nextPreference);
            persistedPreferenceRef.current = nextPreference;
          });
        writeQueueRef.current = write.catch(() => undefined);

        try {
          await write;
        } catch (error) {
          if (latestWriteIdRef.current === writeId) {
            setPreferenceState(persistedPreferenceRef.current);
          }
          throw error;
        }
      },
    }),
    [isLoaded, preference, systemColorScheme]
  );

  return (
    <ThemePreferencesContext.Provider value={value}>
      {children}
    </ThemePreferencesContext.Provider>
  );
}

function useThemePreferencesContext() {
  const context = useContext(ThemePreferencesContext);
  if (!context) {
    throw new Error('Theme preferences must be used inside ThemePreferenceProvider.');
  }
  return context;
}

export function useThemePreference() {
  const { isLoaded, preference, setPreference } = useThemePreferencesContext();
  return { isLoaded, preference, setPreference };
}

export function useResolvedColorScheme(): ResolvedColorScheme {
  return useThemePreferencesContext().colorScheme;
}
