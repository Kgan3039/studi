import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { User } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SearchBar } from '@/components/ui/SearchBar';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Brand, Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import {
  startFriendRequestCooldown,
  useFriendRequestCooldown,
} from '@/lib/friend-request-cooldown';
import { subscribeToAuthState } from '@/lib/auth';
import { getUserProfile, type UserProfile } from '@/lib/firestore';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  FRIEND_SEARCH_MIN_QUERY_LENGTH,
  getFriendStatus,
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
  type FriendStatus,
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
  const friendRequestCooldown = useFriendRequestCooldown();

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

  // Incoming and outgoing requests paginate FULLY independently (own cursor,
  // hasMore, loading flag, in-flight guard, and Load-more control) so neither
  // section can starve the other.
  const [incoming, setIncoming] = useState<FriendRequestListItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestListItem[]>([]);
  const [requestsState, setRequestsState] = useState<LoadState>('loading');
  const [incomingLoadingMore, setIncomingLoadingMore] = useState(false);
  const [outgoingLoadingMore, setOutgoingLoadingMore] = useState(false);
  const [incomingCanLoadMore, setIncomingCanLoadMore] = useState(false);
  const [outgoingCanLoadMore, setOutgoingCanLoadMore] = useState(false);
  const incomingCursor = useRef<QueryDocumentSnapshot | null>(null);
  const outgoingCursor = useRef<QueryDocumentSnapshot | null>(null);
  const incomingInFlight = useRef(false);
  const outgoingInFlight = useRef(false);

  const [suggested, setSuggested] = useState<SuggestedClassmate[]>([]);
  const [suggestedState, setSuggestedState] = useState<LoadState>('loading');

  // Guards against overlapping page fetches (Friends onEndReached fires repeatedly).
  const loadingMoreRef = useRef(false);

  // Optimistic action bookkeeping — uids we've already acted on this session.
  const [pendingUids, setPendingUids] = useState<Set<string>>(() => new Set());

  // Search.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchState, setSearchState] = useState<LoadState | 'idle'>('idle');
  const [sentTo, setSentTo] = useState<Set<string>>(() => new Set());
  const [searchStatuses, setSearchStatuses] = useState<Map<string, FriendStatus>>(
    () => new Map()
  );
  const [pendingRemoval, setPendingRemoval] = useState<{ uid: string; name: string } | null>(
    null
  );
  const [pendingRequest, setPendingRequest] = useState<{
    uid: string;
    name: string;
    source: 'search' | 'suggested';
  } | null>(null);

  /**
   * A search hit is not necessarily a stranger. Without this, someone you're
   * already buddies with — or who already requested you — still renders an
   * "Add" button, which either fails against the rules or creates a second
   * request pointing the other way.
   */
  const relationshipByUid = useMemo(() => {
    const relationships = new Map<string, FriendStatus>();

    for (const item of friends) {
      relationships.set(item.friendUid, 'friends');
    }
    for (const item of incoming) {
      if (!relationships.has(item.otherUid)) {
        relationships.set(item.otherUid, 'incoming');
      }
    }
    for (const item of outgoing) {
      if (!relationships.has(item.otherUid)) {
        relationships.set(item.otherUid, 'outgoing');
      }
    }
    // Resolved per search hit, so it wins over whatever the tab lists happen
    // to have cached.
    for (const [uid, status] of searchStatuses) {
      relationships.set(uid, status);
    }
    // Sent this session — last so an optimistic send always shows.
    for (const uid of sentTo) {
      if ((relationships.get(uid) ?? 'none') === 'none') {
        relationships.set(uid, 'outgoing');
      }
    }

    return relationships;
  }, [friends, incoming, outgoing, searchStatuses, sentTo]);

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
      outgoingCursor.current = out.cursor;
      setIncomingCanLoadMore(inc.hasMore);
      setOutgoingCanLoadMore(out.hasMore);
      setRequestsState('ready');
    } catch {
      setRequestsState('error');
    }
  }, [currentUser]);

  const loadMoreIncoming = useCallback(async () => {
    if (!currentUser || incomingInFlight.current || !incomingCursor.current) return;
    incomingInFlight.current = true;
    setIncomingLoadingMore(true);
    try {
      const page = await getIncomingRequestsPage(currentUser.uid, incomingCursor.current);
      incomingCursor.current = page.cursor;
      setIncomingCanLoadMore(page.hasMore);
      setIncoming((current) => {
        const seen = new Set(current.map((item) => item.otherUid));
        return [...current, ...page.items.filter((item) => !seen.has(item.otherUid))];
      });
    } catch {
      // Keep loaded rows; the button stays available to retry.
    } finally {
      incomingInFlight.current = false;
      setIncomingLoadingMore(false);
    }
  }, [currentUser]);

  const loadMoreOutgoing = useCallback(async () => {
    if (!currentUser || outgoingInFlight.current || !outgoingCursor.current) return;
    outgoingInFlight.current = true;
    setOutgoingLoadingMore(true);
    try {
      const page = await getOutgoingRequestsPage(currentUser.uid, outgoingCursor.current);
      outgoingCursor.current = page.cursor;
      setOutgoingCanLoadMore(page.hasMore);
      setOutgoing((current) => {
        const seen = new Set(current.map((item) => item.otherUid));
        return [...current, ...page.items.filter((item) => !seen.has(item.otherUid))];
      });
    } catch {
      // Keep loaded rows; the button stays available to retry.
    } finally {
      outgoingInFlight.current = false;
      setOutgoingLoadingMore(false);
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

        // Search runs regardless of which tab is loaded, so the tab lists
        // can't be trusted to know these people. Resolve each hit directly.
        const statuses = await Promise.all(
          results.map(async (result) => {
            try {
              return [result.uid, await getFriendStatus(currentUser.uid, result.uid)] as const;
            } catch {
              return [result.uid, 'none'] as const;
            }
          })
        );
        setSearchStatuses(new Map(statuses));
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

  // Sending and removing both confirm first (accepting/declining/cancelling
  // don't — those already read as a direct response to something).
  async function handleConfirmSend() {
    const target = pendingRequest;
    if (!currentUser || !target) return;
    markPending(target.uid, true);
    try {
      await sendFriendRequest(currentUser.uid, target.uid);
      startFriendRequestCooldown();
      track('friend_request_sent', { source: target.source });
      if (target.source === 'search') {
        setSentTo((current) => new Set(current).add(target.uid));
      } else {
        setSuggested((current) => current.filter((item) => item.profile.uid !== target.uid));
      }
      setPendingRequest(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send that request.';
      Alert.alert('Study Buddy Error', message);
    } finally {
      markPending(target.uid, false);
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

  // Removing a buddy is not undoable from the UI, so it always asks first.
  async function handleConfirmRemove() {
    const target = pendingRemoval;
    if (!currentUser || !target) return;
    markPending(target.uid, true);
    try {
      await removeFriend(currentUser.uid, target.uid);
      track('friend_removed');
      setFriends((current) => current.filter((item) => item.friendUid !== target.uid));
      setPendingRemoval(null);
    } catch {
      // keep the row
    } finally {
      markPending(target.uid, false);
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
        <SearchBar
          accessibilityLabel="Find classmates"
          onChangeText={setSearchQuery}
          placeholder="Find classmates by name"
          value={searchQuery}
        />

        {!isSearching ? (
          <SegmentedControl
            accessibilityLabel="Study buddy view"
            onChange={setTab}
            options={TABS.map((option) => ({ label: option.label, value: option.key }))}
            value={tab}
          />
        ) : null}
      </View>

      <ScreenTransition style={styles.results}>
      {isSearching ? (
        <SearchResults
          state={searchState}
          results={searchResults}
          myClasses={myClasses}
          pendingUids={pendingUids}
          relationshipByUid={relationshipByUid}
          palette={palette}
          onOpen={openProfile}
          onSend={(uid, name) => setPendingRequest({ uid, name, source: 'search' })}
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
          onRemove={(uid, name) => setPendingRemoval({ uid, name })}
          onBrowseSuggested={() => setTab('suggested')}
        />
      ) : tab === 'requests' ? (
        <RequestsList
          state={requestsState}
          incoming={incoming}
          outgoing={outgoing}
          pendingUids={pendingUids}
          palette={palette}
          incomingCanLoadMore={incomingCanLoadMore}
          outgoingCanLoadMore={outgoingCanLoadMore}
          incomingLoadingMore={incomingLoadingMore}
          outgoingLoadingMore={outgoingLoadingMore}
          onLoadMoreIncoming={loadMoreIncoming}
          onLoadMoreOutgoing={loadMoreOutgoing}
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
          onSend={(uid, name) => setPendingRequest({ uid, name, source: 'suggested' })}
        />
      )}
      </ScreenTransition>

      <View style={{ height: insets.bottom }} />

      <ConfirmDialog
        visible={!!pendingRequest}
        title={`Send ${pendingRequest?.name ?? 'this student'} a study buddy request?`}
        body="They'll see your request and can accept or ignore it."
        confirmLabel={
          friendRequestCooldown > 0
            ? `Send request in ${friendRequestCooldown}s`
            : 'Send request'
        }
        confirmDisabled={friendRequestCooldown > 0}
        loading={!!pendingRequest && pendingUids.has(pendingRequest.uid)}
        onConfirm={handleConfirmSend}
        onCancel={() => setPendingRequest(null)}
      />

      <ConfirmDialog
        visible={!!pendingRemoval}
        title={`Remove ${pendingRemoval?.name ?? 'this student'}?`}
        body="You'll both stop being study buddies. You can send a new request later."
        confirmLabel="Remove"
        loading={!!pendingRemoval && pendingUids.has(pendingRemoval.uid)}
        onConfirm={handleConfirmRemove}
        onCancel={() => setPendingRemoval(null)}
      />
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
      headline="Couldn’t load study buddies"
      body="Check your connection and try again."
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
  onRemove: (uid: string, name: string) => void;
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
              { borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
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
              onPress={() => onRemove(item.friendUid, name)}
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
  incomingCanLoadMore,
  outgoingCanLoadMore,
  incomingLoadingMore,
  outgoingLoadingMore,
  onLoadMoreIncoming,
  onLoadMoreOutgoing,
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
  incomingCanLoadMore: boolean;
  outgoingCanLoadMore: boolean;
  incomingLoadingMore: boolean;
  outgoingLoadingMore: boolean;
  onLoadMoreIncoming: () => void;
  onLoadMoreOutgoing: () => void;
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
        icon="people"
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
    | { kind: 'outgoing'; id: string; item: FriendRequestListItem }
    | { kind: 'loadmore'; id: string; section: 'incoming' | 'outgoing'; loading: boolean };

  // Each section gets its OWN Load-more row, so incoming and outgoing paginate
  // independently — neither can starve the other (a combined onEndReached
  // could exhaust one side before ever reaching the other).
  const rows: Section[] = [];
  if (incoming.length > 0) {
    rows.push({ kind: 'header', id: 'h-in', label: `Requests (${incoming.length})` });
    incoming.forEach((item) =>
      rows.push({ kind: 'incoming', id: `in-${item.otherUid}`, item })
    );
    if (incomingCanLoadMore) {
      rows.push({ kind: 'loadmore', id: 'more-in', section: 'incoming', loading: incomingLoadingMore });
    }
  }
  if (outgoing.length > 0) {
    rows.push({ kind: 'header', id: 'h-out', label: `Sent (${outgoing.length})` });
    outgoing.forEach((item) =>
      rows.push({ kind: 'outgoing', id: `out-${item.otherUid}`, item })
    );
    if (outgoingCanLoadMore) {
      rows.push({ kind: 'loadmore', id: 'more-out', section: 'outgoing', loading: outgoingLoadingMore });
    }
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={styles.listContent}
      renderItem={({ item: row }) => {
        if (row.kind === 'header') {
          return (
            <Text style={[TypeScale.sectionTitle, styles.sectionHeader, { color: palette.text }]}>
              {row.label}
            </Text>
          );
        }
        if (row.kind === 'loadmore') {
          return (
            <View style={styles.loadMoreRow}>
              <Button
                label="Load more"
                variant="secondary"
                size="sm"
                loading={row.loading}
                onPress={row.section === 'incoming' ? onLoadMoreIncoming : onLoadMoreOutgoing}
              />
            </View>
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
              { borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
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
  onSend: (uid: string, name: string) => void;
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
          <Text style={[TypeScale.sectionTitle, styles.sectionHeader, { color: palette.text }]}>
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
              { borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
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
              onPress={() => onSend(item.profile.uid, name)}
            />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="people"
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
  relationshipByUid,
  palette,
  onOpen,
  onSend,
}: {
  state: LoadState | 'idle';
  results: UserProfile[];
  myClasses: string[];
  pendingUids: Set<string>;
  relationshipByUid: Map<string, FriendStatus>;
  palette: Palette;
  onOpen: (uid: string) => void;
  onSend: (uid: string, name: string) => void;
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
        headline="Search unavailable"
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
        const relationship = relationshipByUid.get(item.uid) ?? 'none';
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item.uid)}
            style={({ pressed }) => [
              styles.row,
              { borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Avatar name={item.displayName || 'Student'} size="md" verified />
            <View style={styles.rowBody}>
              <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
                {item.displayName || 'Student'}
              </Text>
              <SharedClassRow codes={shared} />
            </View>
            {relationship === 'incoming' ? (
              // They asked first — answering happens on their request row, so
              // this points there instead of offering a mirrored request.
              <Button
                label="Respond"
                size="sm"
                variant="secondary"
                onPress={() => onOpen(item.uid)}
              />
            ) : (
              <Button
                label={
                  relationship === 'friends'
                    ? 'Buddies'
                    : relationship === 'outgoing'
                      ? 'Requested'
                      : 'Add'
                }
                size="sm"
                variant={relationship === 'none' ? 'primary' : 'secondary'}
                disabled={relationship !== 'none' || pendingUids.has(item.uid)}
                onPress={() => onSend(item.uid, item.displayName || 'this student')}
              />
            )}
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="people"
          headline="No matches"
          body="Try a different name. Studi only shows verified UW students."
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    gap: Space.md,
    paddingHorizontal: Space.lg + 4,
    paddingBottom: Space.md,
  },
  results: {
    flex: 1,
  },
  centerArea: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 240,
  },
  listContent: {
    padding: Space.lg + 4,
    paddingTop: Space.sm,
    gap: 0,
  },
  sectionHeader: {
    marginTop: Space.sm,
    marginBottom: Space.xs,
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
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
  loadMoreRow: {
    alignItems: 'center',
    paddingVertical: Space.sm,
  },
});
