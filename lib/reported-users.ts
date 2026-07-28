import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@studi/reported-user-ids';

/**
 * Remembers who this person has reported, so the report control can show it.
 *
 * Reports are deliberately write-only in firestore.rules (`allow read: if
 * false`) — moderation data must not be enumerable by clients — so there is no
 * server-side way to ask "have I reported them?". This is therefore a local
 * convenience only: it is per-device, it does not follow the account to a new
 * phone, and it must never be treated as authoritative. The durable signal is
 * the block that every report now also creates, which IS server-readable.
 */
export async function getReportedUserIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function rememberReportedUser(userId: string): Promise<void> {
  if (!userId) {
    return;
  }

  try {
    const current = await getReportedUserIds();
    if (current.includes(userId)) {
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...current, userId]));
  } catch {
    // A missed note only costs the indicator, never the report itself.
  }
}
