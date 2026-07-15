import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { User } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import { getUserProfile, type UserProfile } from '@/lib/firestore';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  FRIEND_SEARCH_MIN_QUERY_LENGTH,
  getFriendsPage,
  getIncomingRequestsPage,
  getOutgoingRequestsPage,
  getSuggestedClassmates,
  removeFriend,
  searchUsersByNamePrefix,
  sendFriendRequest,
  sharedClasses,
  type FriendListItem,
  type FriendRequestListItem,
  type SuggestedClassmate,
} from '@/lib/friends';

type Tab = 'friends' | 'requests' | 'suggested';
type LoadState = 'loading' | 'ready' | 'error';

const TABS: { key: Tab; label: string }[] = [
  { key: 'friends', label: 'Friends' },
  { key: 'requests', label: 'Requests' },
  { key: 'suggested', label: 'Suggested' },
];

const SEARCH_DEBOUNCE_MS = 300;

export default function FriendsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [myClasses, setMyClasses] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('friends');

  // Per-tab data + load state. Cursors live in refs so onEndReached always
  // reads the latest page boundary without re-subscribing the handler.
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [friendsState, setFriendsState] = useState<LoadState>('loading');
  const [friendsLoadingMore, setFriendsLoadingMore] = useState(false);
  const friendsCursor = useRef<QueryDocumentSnapshot | null>(null);
  const friendsHasMore = useRef(false);

  const [incoming, setIncoming] = useState<FriendRequestListItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestListItem[]>([]);
  const [requestsState, setRequestsState] = useState<LoadState>('loading');
  const [requestsLoadingMore, setRequestsLoadingMore] = useState(false);
  const incomingCursor = useRef<QueryDocumentSnapshot | null>(null);
  const incomingHasMore = useRef(false);
  const outgoingCursor = useRef<QueryDocumentSnapshot | null>(null);
  const outgoingHasMore = useRef(false);

  const [suggested, setSuggested] = useState<SuggestedClassmate[]>([]);
  const [suggestedState, setSuggestedState] = useState<LoadState>('loading');

  // Guards against overlapping page fetches (onEndReached fires repeatedly).
  const loadingMoreRef = useRef(false);

  // Optimistic action bookkeeping — uids we've already acted on this session.
  const [pendingUids, setPendingUids] = useState<Set<string>>(() => new Set());

  // Search.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchState, setSearchState] = useState<LoadState | 'idle'>('idle');
  const [sentTo, setSentTo] = useState<Set<string>>(() => new Set());

  useEffect(() => subscribeToAuthState(setCurrentUser), []);

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    let cancelled = false;
    getUserProfile(currentUser.uid)
      .then((profile) => {
        if (!cancelled) {
          setMyClasses(profile?.classes ?? []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const loadFriends = useCallback(async () => {
    if (!currentUser) return;
    setFriendsState('loading');
    try {
      const page = await getFriendsPage(currentUser.uid);
      setFriends(page.items);
      friendsCursor.current = page.cursor;
      friendsHasMore.current = page.hasMore;
      setFriendsState('ready');
    } catch {
      setFriendsState('error');
    }
  }, [currentUser]);

  const loadMoreFriends = useCallback(async () => {
    if (!currentUser || loadingMoreRef.current || !friendsHasMore.current) return;
    loadingMoreRef.current = true;
    setFriendsLoadingMore(true);
    try {
      const page = await getFriendsPage(currentUser.uid, friendsCursor.current);
      friendsCursor.current = page.cursor;
      friendsHasMore.current = page.hasMore;
      // Dedupe by deterministic friend uid so a boundary overlap can't double a row.
      setFriends((current) => {
        const seen = new Set(current.map((item) => item.friendUid));
        return [...current, ...page.items.filter((item) => !seen.has(item.friendUid))];
      });
    } catch {
      // Keep the loaded rows; the next end-reach retries.
    } finally {
      loadingMoreRef.current = false;
      setFriendsLoadingMore(false);
    }
  }, [currentUser]);

  const loadRequests = useCallback(async () => {
    if (!currentUser) return;
    setRequestsState('loading');
    try {
      const [inc, out] = await Promise.all([
        getIncomingRequestsPage(currentUser.uid),
        getOutgoingRequestsPage(currentUser.uid),
      ]);
      setIncoming(inc.items);
      setOutgoing(out.items);
      incomingCursor.current = inc.cursor;
      incomingHasMore.current = inc.hasMore;
      outgoingCursor.current = out.cursor;
      outgoingHasMore.current = out.hasMore;
      setRequestsState('ready');
    } catch {
      setRequestsState('error');
    }
  }, [currentUser]);

  const loadMoreRequests = useCallback(async () => {
    if (!currentUser || loadingMoreRef.current) return;
    if (!outgoingHasMore.current && !incomingHasMore.current) return;
    loadingMoreRef.current = true;
    setRequestsLoadingMore(true);
    try {
      // The combined list renders incoming above outgoing, so the bottom that
      // triggers onEndReached is the outgoing tail — page that first, then
      // fall through to incoming once outgoing is exhausted.
      if (outgoingHasMore.current) {
        const page = await getOutgoingRequestsPage(currentUser.uid, outgoingCursor.current);
        outgoingCursor.current = page.cursor;
        outgoingHasMore.current = page.hasMore;
        setOutgoing((current) => {
          const seen = new Set(current.map((item) => item.otherUid));
          return [...current, ...page.items.filter((item) => !seen.has(item.otherUid))];
        });
      } else if (incomingHasMore.current) {
        const page = await getIncomingRequestsPage(currentUser.uid, incomingCursor.current);
        incomingCursor.current = page.cursor;
        incomingHasMore.current = page.hasMore;
        setIncoming((current) => {
          const seen = new Set(current.map((item) => item.otherUid));
          return [...current, ...page.items.filter((item) => !seen.has(item.otherUid))];
        });
      }
    } catch {
      // Keep the loaded rows; the next end-reach retries.
    } finally {
      loadingMoreRef.current = false;
      setRequestsLoadingMore(false);
    }
  }, [currentUser]);

  const loadSuggested = useCallback(async () => {
    if (!currentUser) return;
    setSuggestedState('loading');
    try {
      // The callable excludes self, friends, pending requests (either way), and
      // blocks (both directions) server-side, and returns a bounded list — no
      // client-side relationship scan and no leak of blocked candidates.
      const results = await getSuggestedClassmates();
      setSuggested(results);
      setSuggestedState('ready');
    } catch {
      setSuggestedState('error');
    }
  }, [currentUser]);

  // Reload the active tab on focus and when it changes.
  useFocusEffect(
    useCallback(() => {
      if (!currentUser) return;
      track('friends_viewed', { tab });
      if (tab === 'friends') loadFriends();
      else if (tab === 'requests') loadRequests();
      else loadSuggested();
    }, [currentUser, tab, loadFriends, loadRequests, loadSuggested])
  );

  // Debounced search — runs independent of the active tab.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentUser) return;
    const trimmed = searchQuery.trim();

    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }

    if (trimmed.length < FRIEND_SEARCH_MIN_QUERY_LENGTH) {
      setSearchResults([]);
      setSearchState('idle');
      return;
    }

    setSearchState('loading');
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchUsersByNamePrefix(currentUser.uid, trimmed);
        setSearchResults(results);
        setSearchState('ready');
      } catch {
        setSearchState('error');
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
    };
  }, [currentUser, searchQuery]);

  function markPending(uid: string, isPending: boolean) {
    setPendingUids((current) => {
      const next = new Set(current);
      if (isPending) next.add(uid);
      else next.delete(uid);
      return next;
    });
  }

  async function handleSend(toUid: string, source: 'search' | 'suggested') {
    if (!currentUser) return;
    markPending(toUid, true);
    try {
      await sendFriendRequest(currentUser.uid, toUid);
      track('friend_request_sent', { source });
      if (source === 'search') {
        setSentTo((current) => new Set(current).add(toUid));
      } else {
        setSuggested((current) => current.filter((item) => item.profile.uid !== toUid));
      }
    } catch {
      // Leave the button re-enabled so the user can retry.
    } finally {
      markPending(toUid, false);
    }
  }

  async function handleAccept(fromUid: string) {
    if (!currentUser) return;
    markPending(fromUid, true);
    try {
      await acceptFriendRequest(currentUser.uid, fromUid);
      track('friend_request_accepted');
      setIncoming((current) => current.filter((item) => item.otherUid !== fromUid));
    } catch {
      // keep the row so it can be retried
    } finally {
      markPending(fromUid, false);
    }
  }

  async function handleDecline(fromUid: string) {
    if (!currentUser) return;
    markPending(fromUid, true);
    try {
      await declineFriendRequest(currentUser.uid, fromUid);
      track('friend_request_declined');
      setIncoming((current) => current.filter((item) => item.otherUid !== fromUid));
    } catch {
      // keep the row
    } finally {
      markPending(fromUid, false);
    }
  }

  async function handleCancel(toUid: string) {
    if (!currentUser) return;
    markPending(toUid, true);
    try {
      await cancelFriendRequest(currentUser.uid, toUid);
      track('friend_request_cancelled');
      setOutgoing((current) => current.filter((item) => item.otherUid !== toUid));
    } catch {
      // keep the row
    } finally {
      markPending(toUid, false);
    }
  }

  async function handleRemove(friendUid: string) {
    if (!currentUser) return;
    markPending(friendUid, true);
    try {
      await removeFriend(currentUser.uid, friendUid);
      track('friend_removed');
      setFriends((current) => current.filter((item) => item.friendUid !== friendUid));
    } catch {
      // keep the row
    } finally {
      markPending(friendUid, false);
    }
  }

  function openProfile(uid: string) {
    // Concrete href string, cast until expo-router regenerates typed routes
    // for the new screen on the next dev-server run (same convention as the
    // /friends push in app/(tabs)/profile.tsx).
    router.push(`/user/${uid}` as Href);
  }

  const isSearching = searchQuery.trim().length >= FRIEND_SEARCH_MIN_QUERY_LENGTH;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: 'Study Buddies' }} />

      <View style={[styles.header, { paddingTop: Space.sm }]}>
        {/* Search — always visible; results replace the tab content. */}
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearchQuery}
          placeholder="Find classmates by name"
          placeholderTextColor={placeholderColor}
          returnKeyType="search"
          style={[
            styles.searchInput,
            { backgroundColor: palette.surfaceMuted, borderColor: palette.border, color: palette.text },
          ]}
          value={searchQuery}
        />

        {!isSearching ? (
          <View style={[styles.segmented, { backgroundColor: palette.surfaceMuted }]}>
            {TABS.map((tabOption) => {
              const active = tab === tabOption.key;
              return (
                <Pressable
                  key={tabOption.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(tabOption.key)}
                  style={[
                    styles.segment,
                    active && { backgroundColor: palette.surface, ...segmentShadow },
                  ]}>
                  <Text
                    style={[
                      TypeScale.label,
                      { color: active ? palette.text : palette.icon },
                    ]}>
                    {tabOption.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {isSearching ? (
        <SearchResults
          state={searchState}
          results={searchResults}
          myClasses={myClasses}
          pendingUids={pendingUids}
          sentTo={sentTo}
          palette={palette}
          onOpen={openProfile}
          onSend={(uid) => handleSend(uid, 'search')}
        />
      ) : tab === 'friends' ? (
        <FriendsList
          state={friendsState}
          friends={friends}
          myClasses={myClasses}
          pendingUids={pendingUids}
          palette={palette}
          loadingMore={friendsLoadingMore}
          onEndReached={loadMoreFriends}
          onRetry={loadFriends}
          onOpen={openProfile}
          onRemove={handleRemove}
          onBrowseSuggested={() => setTab('suggested')}
        />
      ) : tab === 'requests' ? (
        <RequestsList
          state={requestsState}
          incoming={incoming}
          outgoing={outgoing}
          pendingUids={pendingUids}
          palette={palette}
          loadingMore={requestsLoadingMore}
          onEndReached={loadMoreRequests}
          onRetry={loadRequests}
          onOpen={openProfile}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onCancel={handleCancel}
          onBrowseSuggested={() => setTab('suggested')}
        />
      ) : (
        <SuggestedList
          state={suggestedState}
          suggested={suggested}
          pendingUids={pendingUids}
          palette={palette}
          hasClasses={myClasses.length > 0}
          onRetry={loadSuggested}
          onOpen={openProfile}
          onSend={(uid) => handleSend(uid, 'suggested')}
        />
      )}

      <View style={{ height: insets.bottom }} />
    </View>
  );
}

// Both light and dark palettes share these keys; widen every value to string
// so a `Colors[scheme]` union is assignable (dark's values aren't literals).
type Palette = { [K in keyof (typeof Colors)['light']]: string };

function LoadingOrError({
  state,
  palette,
  onRetry,
}: {
  state: LoadState;
  palette: Palette;
  onRetry: () => void;
}) {
  if (state === 'loading') {
    return (
      <View style={styles.centerArea}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }
  return (
    <EmptyState
      headline="Something went off-script."
      body="We couldn't load this just now."
      actionLabel="Try again"
      onAction={onRetry}
    />
  );
}

function ListFooter({ loading, palette }: { loading: boolean; palette: Palette }) {
  if (!loading) {
    return null;
  }
  return (
    <View style={styles.footerLoading}>
      <ActivityIndicator color={palette.tint} />
    </View>
  );
}

function SharedClassRow({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return null;
  }
  return (
    <View style={styles.chipRow}>
      {codes.slice(0, 3).map((code) => (
        <CourseChip key={code} code={code} size="sm" />
      ))}
      {codes.length > 3 ? (
        <Text style={styles.moreChips}>+{codes.length - 3}</Text>
      ) : null}
    </View>
  );
}

function FriendsList({
  state,
  friends,
  myClasses,
  pendingUids,
  palette,
  loadingMore,
  onEndReached,
  onRetry,
  onOpen,
  onRemove,
  onBrowseSuggested,
}: {
  state: LoadState;
  friends: FriendListItem[];
  myClasses: string[];
  pendingUids: Set<string>;
  palette: Palette;
  loadingMore: boolean;
  onEndReached: () => void;
  onRetry: () => void;
  onOpen: (uid: string) => void;
  onRemove: (uid: string) => void;
  onBrowseSuggested: () => void;
}) {
  if (state !== 'ready') {
    return <LoadingOrError state={state} palette={palette} onRetry={onRetry} />;
  }

  return (
    <FlatList
      data={friends}
      keyExtractor={(item) => item.friendUid}
      contentContainerStyle={styles.listContent}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      ListFooterComponent={<ListFooter loading={loadingMore} palette={palette} />}
      renderItem={({ item }) => {
        const name = item.profile?.displayName || 'Student';
        const shared = sharedClasses(myClasses, item.profile?.classes ?? []);
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item.friendUid)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Avatar name={name} size="md" verified />
            <View style={styles.rowBody}>
              <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
                {name}
              </Text>
              <SharedClassRow codes={shared} />
            </View>
            <Button
              label="Remove"
              variant="ghost"
              size="sm"
              disabled={pendingUids.has(item.friendUid)}
              onPress={() => onRemove(item.friendUid)}
            />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="dot"
          headline="No study buddies yet"
          body="Find classmates by name, or check who's in your classes."
          actionLabel="See suggestions"
          onAction={onBrowseSuggested}
        />
      }
    />
  );
}

function RequestsList({
  state,
  incoming,
  outgoing,
  pendingUids,
  palette,
  loadingMore,
  onEndReached,
  onRetry,
  onOpen,
  onAccept,
  onDecline,
  onCancel,
  onBrowseSuggested,
}: {
  state: LoadState;
  incoming: FriendRequestListItem[];
  outgoing: FriendRequestListItem[];
  pendingUids: Set<string>;
  palette: Palette;
  loadingMore: boolean;
  onEndReached: () => void;
  onRetry: () => void;
  onOpen: (uid: string) => void;
  onAccept: (uid: string) => void;
  onDecline: (uid: string) => void;
  onCancel: (uid: string) => void;
  onBrowseSuggested: () => void;
}) {
  if (state !== 'ready') {
    return <LoadingOrError state={state} palette={palette} onRetry={onRetry} />;
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <EmptyState
        icon="dot"
        headline="No pending requests"
        body="Requests you send and receive show up here."
        actionLabel="See suggestions"
        onAction={onBrowseSuggested}
      />
    );
  }

  type Section =
    | { kind: 'header'; id: string; label: string }
    | { kind: 'incoming'; id: string; item: FriendRequestListItem }
    | { kind: 'outgoing'; id: string; item: FriendRequestListItem };

  const rows: Section[] = [];
  if (incoming.length > 0) {
    rows.push({ kind: 'header', id: 'h-in', label: `Requests · ${incoming.length}` });
    incoming.forEach((item) =>
      rows.push({ kind: 'incoming', id: `in-${item.otherUid}`, item })
    );
  }
  if (outgoing.length > 0) {
    rows.push({ kind: 'header', id: 'h-out', label: `Sent · ${outgoing.length}` });
    outgoing.forEach((item) =>
      rows.push({ kind: 'outgoing', id: `out-${item.otherUid}`, item })
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={styles.listContent}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      ListFooterComponent={<ListFooter loading={loadingMore} palette={palette} />}
      renderItem={({ item: row }) => {
        if (row.kind === 'header') {
          return (
            <Text style={[TypeScale.eyebrow, styles.sectionHeader, { color: palette.icon }]}>
              {row.label}
            </Text>
          );
        }
        const item = row.item;
        const name = item.profile?.displayName || 'Student';
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item.otherUid)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Avatar name={name} size="md" verified />
            <View style={styles.rowBody}>
              <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
                {name}
              </Text>
              <Text style={[TypeScale.caption, { color: palette.icon }]}>
                {row.kind === 'incoming' ? 'Wants to be study buddies' : 'Request sent'}
              </Text>
            </View>
            {row.kind === 'incoming' ? (
              <View style={styles.actionCol}>
                <Button
                  label="Accept"
                  size="sm"
                  disabled={pendingUids.has(item.otherUid)}
                  onPress={() => onAccept(item.otherUid)}
                />
                <Button
                  label="Decline"
                  variant="ghost"
                  size="sm"
                  disabled={pendingUids.has(item.otherUid)}
                  onPress={() => onDecline(item.otherUid)}
                />
              </View>
            ) : (
              <Button
                label="Cancel"
                variant="secondary"
                size="sm"
                disabled={pendingUids.has(item.otherUid)}
                onPress={() => onCancel(item.otherUid)}
              />
            )}
          </Pressable>
        );
      }}
    />
  );
}

function SuggestedList({
  state,
  suggested,
  pendingUids,
  palette,
  hasClasses,
  onRetry,
  onOpen,
  onSend,
}: {
  state: LoadState;
  suggested: SuggestedClassmate[];
  pendingUids: Set<string>;
  palette: Palette;
  hasClasses: boolean;
  onRetry: () => void;
  onOpen: (uid: string) => void;
  onSend: (uid: string) => void;
}) {
  if (state !== 'ready') {
    return <LoadingOrError state={state} palette={palette} onRetry={onRetry} />;
  }

  return (
    <FlatList
      data={suggested}
      keyExtractor={(item) => item.profile.uid}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        suggested.length > 0 ? (
          <Text style={[TypeScale.eyebrow, styles.sectionHeader, { color: palette.icon }]}>
            From your classes
          </Text>
        ) : null
      }
      renderItem={({ item }) => {
        const name = item.profile.displayName || 'Student';
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item.profile.uid)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Avatar name={name} size="md" verified />
            <View style={styles.rowBody}>
              <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
                {name}
              </Text>
              <SharedClassRow codes={item.sharedClasses} />
            </View>
            <Button
              label="Add"
              size="sm"
              disabled={pendingUids.has(item.profile.uid)}
              onPress={() => onSend(item.profile.uid)}
            />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="dot"
          headline={hasClasses ? 'No classmates to suggest yet' : 'Add your classes first'}
          body={
            hasClasses
              ? "When people in your classes join Studi, they'll show up here."
              : 'Save the courses you take on your profile to see classmates here.'
          }
        />
      }
    />
  );
}

function SearchResults({
  state,
  results,
  myClasses,
  pendingUids,
  sentTo,
  palette,
  onOpen,
  onSend,
}: {
  state: LoadState | 'idle';
  results: UserProfile[];
  myClasses: string[];
  pendingUids: Set<string>;
  sentTo: Set<string>;
  palette: Palette;
  onOpen: (uid: string) => void;
  onSend: (uid: string) => void;
}) {
  if (state === 'loading') {
    return (
      <View style={styles.centerArea}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }
  if (state === 'error') {
    return (
      <EmptyState
        headline="Search hiccuped."
        body="Check your connection and try that search again."
      />
    );
  }

  return (
    <FlatList
      data={results}
      keyExtractor={(item) => item.uid}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => {
        const shared = sharedClasses(myClasses, item.classes);
        const alreadySent = sentTo.has(item.uid);
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item.uid)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Avatar name={item.displayName || 'Student'} size="md" verified />
            <View style={styles.rowBody}>
              <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
                {item.displayName || 'Student'}
              </Text>
              <SharedClassRow codes={shared} />
            </View>
            <Button
              label={alreadySent ? 'Sent' : 'Add'}
              size="sm"
              variant={alreadySent ? 'secondary' : 'primary'}
              disabled={alreadySent || pendingUids.has(item.uid)}
              onPress={() => onSend(item.uid)}
            />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="dot"
          headline="No matches"
          body="Try a different name — Studi only shows verified UW students."
        />
      }
    />
  );
}

const segmentShadow = {
  shadowColor: Brand.text,
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 3,
  elevation: 1,
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    gap: Space.md,
    paddingHorizontal: Space.lg + 4,
    paddingBottom: Space.md,
  },
  searchInput: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: Space.lg,
  },
  segmented: {
    borderRadius: Radius.pill,
    flexDirection: 'row',
    padding: 3,
  },
  segment: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: Space.sm,
  },
  centerArea: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 240,
  },
  listContent: {
    padding: Space.lg + 4,
    paddingTop: Space.sm,
    gap: Space.sm,
  },
  sectionHeader: {
    marginTop: Space.sm,
    marginBottom: Space.xs,
  },
  row: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 64,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm,
  },
  rowBody: {
    flex: 1,
    gap: Space.xs,
  },
  chipRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.xs,
  },
  moreChips: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 12,
    color: Brand.textSubtle,
  },
  actionCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  footerLoading: {
    paddingVertical: Space.lg,
  },
});
