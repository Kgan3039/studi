// lib/friends.ts — client data layer for Friends / Study Buddies (PR 6).
//
// Data model (mirrored in firestore.rules — the rules are the enforcement):
//   friendRequests/{fromUid}__{toUid}   { fromUid, toUid, createdAt }
//     Doc existence IS the pending state. Create = send, delete by sender =
//     cancel, delete by recipient = decline or accept.
//   friendships/{sortedUidA}__{sortedUidB}   { userIds, acceptedBy, createdAt }
//     Created only by the request recipient, in the same batch that deletes
//     the request — rules enforce the atomicity with exists/existsAfter.
//
// Every list here is paginated and every profile hydration goes through
// getProfilesByIds (batched + cached) — no unbounded reads, no N+1.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { FirebaseError } from "firebase/app";

import { getFunctions, httpsCallable } from "firebase/functions";

import app, { auth, db } from "../firebaseConfig";
import {
  FRIEND_REQUEST_COOLDOWN_MS,
} from "./friend-request-control";
import {
  FriendRequestAuthError,
  FriendRequestCooldownError,
} from "./friend-request-errors";
import {
  buildParticipantKey,
  COLLECTIONS,
  getProfilesByIds,
  parseUserProfile,
  stageFriendRequestRateLimit,
  type UserProfile,
} from "./firestore";

export const FRIENDS_PAGE_SIZE = 30;
export const FRIEND_SEARCH_LIMIT = 20;
export const FRIEND_SEARCH_MIN_QUERY_LENGTH = 2;

export type FriendRequest = {
  requestId: string;
  fromUid: string;
  toUid: string;
  createdAt: Timestamp | null;
};

export type Friendship = {
  friendshipId: string;
  userIds: string[];
  acceptedBy: string;
  createdAt: Timestamp | null;
};

/** A friend row: the other user's uid plus their (possibly deleted) profile. */
export type FriendListItem = {
  friendUid: string;
  profile: UserProfile | null;
  createdAt: Timestamp | null;
};

/** A request row hydrated with the OTHER party's profile. */
export type FriendRequestListItem = FriendRequest & {
  otherUid: string;
  profile: UserProfile | null;
};

export type FriendsPage<T> = {
  items: T[];
  /** Pass back to fetch the next page; null when exhausted. */
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
};

/** How the current user relates to another user, for profile/action states. */
export type FriendStatus =
  | "self"
  | "friends"
  | "outgoing" // we sent them a pending request
  | "incoming" // they sent us a pending request
  | "none";

// Mirrors functions/pair-id.js SAFE_UID_PATTERN and firestore.rules
// isSafeUidComponent. Studi uids are Firebase email/password uids ([A-Za-z0-9]),
// so `{a}__{b}` is an unambiguous, delimiter-free deterministic id. Validated
// here for fail-fast friendly errors; the rules are the actual enforcement.
const SAFE_UID_PATTERN = /^[A-Za-z0-9]{1,128}$/;

export function isSafeUid(uid: string): boolean {
  return typeof uid === "string" && SAFE_UID_PATTERN.test(uid);
}

function assertSafePair(uidA: string, uidB: string) {
  if (!isSafeUid(uidA) || !isSafeUid(uidB)) {
    throw new Error("That account can't be added right now.");
  }
  if (uidA === uidB) {
    throw new Error("You can't add yourself.");
  }
}

/** Directed pair id (friend requests: from → to). */
export function buildFriendRequestId(fromUid: string, toUid: string) {
  return `${fromUid}__${toUid}`;
}

/** Sorted pair key — same convention as DM conversations. */
export function buildFriendshipId(userA: string, userB: string) {
  return buildParticipantKey(userA, userB);
}

/** Class codes both users share, in the viewer's saved order. */
export function sharedClasses(mine: string[], theirs: string[]): string[] {
  const theirSet = new Set(theirs.map((code) => code.trim().toUpperCase()));
  return mine.filter((code) => theirSet.has(code.trim().toUpperCase()));
}

function friendRequestDoc(fromUid: string, toUid: string) {
  return doc(db, COLLECTIONS.friendRequests, buildFriendRequestId(fromUid, toUid));
}

function friendshipDoc(userA: string, userB: string) {
  return doc(db, COLLECTIONS.friendships, buildFriendshipId(userA, userB));
}

function asTimestamp(value: unknown): Timestamp | null {
  return value instanceof Timestamp ? value : null;
}

function parseFriendRequest(id: string, data: Record<string, unknown>): FriendRequest {
  return {
    requestId: id,
    fromUid: typeof data.fromUid === "string" ? data.fromUid : "",
    toUid: typeof data.toUid === "string" ? data.toUid : "",
    createdAt: asTimestamp(data.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Mutations. Rules re-enforce every invariant server-side (self-request,
// duplicates, blocks, atomic accept); the client checks are for friendly
// errors, not security.
// ---------------------------------------------------------------------------

export async function sendFriendRequest(fromUid: string, toUid: string) {
  assertSafePair(fromUid, toUid);
  const requestId = buildFriendRequestId(fromUid, toUid);

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.friendRequests, requestId), {
    fromUid,
    toUid,
    createdAt: serverTimestamp(),
  });
  stageFriendRequestRateLimit(batch, fromUid, requestId);
  try {
    await batch.commit();
  } catch (error) {
    // Rules intentionally return the same permission-denied code for cooldown,
    // blocks, stale verification, and relationship races. Only a recent
    // server-authored limiter timestamp is trusted evidence for cooldown copy.
    if (error instanceof FirebaseError && error.code === "permission-denied") {
      try {
        const limiter = await getDoc(
          doc(db, COLLECTIONS.rateLimits, fromUid, "actions", "friendRequest")
        );
        const updatedAt = limiter.data()?.updatedAt;
        if (
          updatedAt instanceof Timestamp &&
          Date.now() - updatedAt.toMillis() < FRIEND_REQUEST_COOLDOWN_MS
        ) {
          throw new FriendRequestCooldownError();
        }
      } catch (evidenceError) {
        if (evidenceError instanceof FriendRequestCooldownError) {
          throw evidenceError;
        }
        // If the evidence read itself is denied/unavailable, retain the
        // original generic failure rather than guessing.
      }
      if (
        !auth.currentUser ||
        auth.currentUser.uid !== fromUid ||
        !auth.currentUser.emailVerified
      ) {
        throw new FriendRequestAuthError();
      }
    }
    throw error;
  }
}

export async function cancelFriendRequest(fromUid: string, toUid: string) {
  await deleteDoc(friendRequestDoc(fromUid, toUid));
}

export async function declineFriendRequest(currentUid: string, fromUid: string) {
  await deleteDoc(friendRequestDoc(fromUid, currentUid));
}

/**
 * Accept = one atomic batch: delete their incoming request, create the
 * friendship. Rules only allow the friendship create when the request existed
 * before the batch AND is gone after it, so a partial accept can't exist.
 * If both users requested each other, the now-moot outgoing request is
 * deleted in the same batch.
 */
export async function acceptFriendRequest(currentUid: string, fromUid: string) {
  assertSafePair(currentUid, fromUid);
  const outgoing = await getDoc(friendRequestDoc(currentUid, fromUid));

  const batch = writeBatch(db);
  batch.delete(friendRequestDoc(fromUid, currentUid));
  if (outgoing.exists()) {
    batch.delete(friendRequestDoc(currentUid, fromUid));
  }
  batch.set(friendshipDoc(currentUid, fromUid), {
    userIds: [currentUid, fromUid].sort(),
    acceptedBy: currentUid,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function removeFriend(currentUid: string, otherUid: string) {
  await deleteDoc(friendshipDoc(currentUid, otherUid));
}

// ---------------------------------------------------------------------------
// Reads — paginated lists, hydrated through the batched profile cache.
// Composite indexes (firestore.indexes.json):
//   friendships(userIds CONTAINS, createdAt DESC)
//   friendRequests(toUid ASC, createdAt DESC)
//   friendRequests(fromUid ASC, createdAt DESC)
// ---------------------------------------------------------------------------

export async function getFriendsPage(
  currentUid: string,
  cursor?: QueryDocumentSnapshot | null
): Promise<FriendsPage<FriendListItem>> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.friendships),
      where("userIds", "array-contains", currentUid),
      orderBy("createdAt", "desc"),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(FRIENDS_PAGE_SIZE)
    )
  );

  const rows = snapshot.docs.map((docSnap) => {
    const userIds = Array.isArray(docSnap.data().userIds)
      ? (docSnap.data().userIds as unknown[]).filter(
          (id): id is string => typeof id === "string"
        )
      : [];
    return {
      friendUid: userIds.find((id) => id !== currentUid) ?? "",
      createdAt: asTimestamp(docSnap.data().createdAt),
    };
  });

  const profilesById = await getProfilesByIds(rows.map((row) => row.friendUid));
  const hasMore = snapshot.size === FRIENDS_PAGE_SIZE;

  return {
    items: rows
      .filter((row) => row.friendUid)
      .map((row) => ({ ...row, profile: profilesById.get(row.friendUid) ?? null })),
    cursor: hasMore ? snapshot.docs[snapshot.docs.length - 1] : null,
    hasMore,
  };
}

async function getRequestsPage(
  field: "fromUid" | "toUid",
  currentUid: string,
  cursor?: QueryDocumentSnapshot | null
): Promise<FriendsPage<FriendRequestListItem>> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.friendRequests),
      where(field, "==", currentUid),
      orderBy("createdAt", "desc"),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(FRIENDS_PAGE_SIZE)
    )
  );

  const requests = snapshot.docs.map((docSnap) =>
    parseFriendRequest(docSnap.id, docSnap.data())
  );
  const otherUidOf = (request: FriendRequest) =>
    field === "toUid" ? request.fromUid : request.toUid;
  const profilesById = await getProfilesByIds(requests.map(otherUidOf));
  const hasMore = snapshot.size === FRIENDS_PAGE_SIZE;

  return {
    items: requests.map((request) => ({
      ...request,
      otherUid: otherUidOf(request),
      profile: profilesById.get(otherUidOf(request)) ?? null,
    })),
    cursor: hasMore ? snapshot.docs[snapshot.docs.length - 1] : null,
    hasMore,
  };
}

export function getIncomingRequestsPage(
  currentUid: string,
  cursor?: QueryDocumentSnapshot | null
) {
  return getRequestsPage("toUid", currentUid, cursor);
}

export function getOutgoingRequestsPage(
  currentUid: string,
  cursor?: QueryDocumentSnapshot | null
) {
  return getRequestsPage("fromUid", currentUid, cursor);
}

/**
 * Relationship between the viewer and another user: 3 deterministic-ID gets
 * (friendship + both request directions), no queries.
 */
export async function getFriendStatus(
  currentUid: string,
  otherUid: string
): Promise<FriendStatus> {
  if (currentUid === otherUid) {
    return "self";
  }

  const [friendship, outgoing, incoming] = await Promise.all([
    getDoc(friendshipDoc(currentUid, otherUid)),
    getDoc(friendRequestDoc(currentUid, otherUid)),
    getDoc(friendRequestDoc(otherUid, currentUid)),
  ]);

  if (friendship.exists()) {
    return "friends";
  }
  if (incoming.exists()) {
    return "incoming";
  }
  if (outgoing.exists()) {
    return "outgoing";
  }
  return "none";
}

/**
 * Whether a block exists in either direction. Rules allow either side to
 * `get` the single block doc naming them, so both probes are readable —
 * this powers the profile screen's unavailable state.
 */
export async function isBlockedEitherDirection(
  currentUid: string,
  otherUid: string
): Promise<boolean> {
  const [mine, theirs] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.userBlocks, `${currentUid}__${otherUid}`)),
    getDoc(doc(db, COLLECTIONS.userBlocks, `${otherUid}__${currentUid}`)),
  ]);
  return mine.exists() || theirs.exists();
}

// ---------------------------------------------------------------------------
// Search — bounded prefix search on displayNameLower (Firestore range scans
// are case-sensitive, hence the lowercase shadow field written alongside
// every displayName). Legacy profiles created before the field exists are
// covered by a second bounded query on the raw displayName using a
// title-cased variant of the query — most stored names are "First Last" —
// until the documented backfill (scripts/backfill-display-name-lower.mjs)
// runs or the user re-saves their name. Two limit-20 reads per search, ever.
// ---------------------------------------------------------------------------

function titleCase(value: string) {
  return value
    .split(/(\s+)/)
    .map((part) => (part.trim() ? part[0].toUpperCase() + part.slice(1) : part))
    .join("");
}

export async function searchUsersByNamePrefix(
  currentUid: string,
  rawQuery: string
): Promise<UserProfile[]> {
  const normalized = rawQuery.trim().toLowerCase();

  if (normalized.length < FRIEND_SEARCH_MIN_QUERY_LENGTH) {
    return [];
  }

  const usersRef = collection(db, COLLECTIONS.users);
  const prefixEnd = `${normalized}\uf8ff`;
  const legacyPrefix = titleCase(rawQuery.trim());

  const [canonical, legacy] = await Promise.all([
    getDocs(
      query(
        usersRef,
        orderBy("displayNameLower"),
        where("displayNameLower", ">=", normalized),
        where("displayNameLower", "<=", prefixEnd),
        limit(FRIEND_SEARCH_LIMIT)
      )
    ),
    getDocs(
      query(
        usersRef,
        orderBy("displayName"),
        where("displayName", ">=", legacyPrefix),
        where("displayName", "<=", `${legacyPrefix}\uf8ff`),
        limit(FRIEND_SEARCH_LIMIT)
      )
    ),
  ]);

  const byUid = new Map<string, UserProfile>();
  for (const docSnap of [...canonical.docs, ...legacy.docs]) {
    if (docSnap.id === currentUid || byUid.has(docSnap.id)) {
      continue;
    }
    const profile = parseUserProfile(docSnap.id, docSnap.data());
    // The legacy query is case-sensitive over-approximation — keep only real
    // case-insensitive prefix matches so both paths behave identically.
    if (profile.displayName.toLowerCase().startsWith(normalized)) {
      byUid.set(docSnap.id, profile);
    }
  }

  const matches = [...byUid.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, FRIEND_SEARCH_LIMIT);

  // Drop anyone blocked in either direction so a blocked user never appears
  // with an actionable "Add" button. Bounded: ≤ FRIEND_SEARCH_LIMIT results,
  // each a deterministic-ID pair of block gets (both allowed by rules since
  // the caller is named in the block id).
  const blockedFlags = await Promise.all(
    matches.map((profile) => isBlockedEitherDirection(currentUid, profile.uid))
  );
  return matches.filter((_, index) => !blockedFlags[index]);
}

// ---------------------------------------------------------------------------
// Suggestions — served by the getFriendSuggestions Cloud Function, NOT a
// client query. The callable must exclude anyone who BLOCKED the caller, and
// userBlocks list is blocker-only, so a client can't discover who blocked it —
// filtering client-side would leak blocked candidates as actionable "Add"
// rows. The callable checks both block directions with the Admin SDK and
// returns a bounded, already-filtered, already-ranked list, so there is no
// unbounded scan and no N+1 profile read on the client.
// ---------------------------------------------------------------------------

export type SuggestedClassmate = {
  profile: UserProfile;
  sharedClasses: string[];
};

type FriendSuggestionDTO = {
  uid: string;
  displayName: string;
  classes: string[];
  sharedClasses: string[];
};

export async function getSuggestedClassmates(): Promise<SuggestedClassmate[]> {
  const callable = httpsCallable<unknown, { suggestions: FriendSuggestionDTO[] }>(
    getFunctions(app, "us-central1"),
    "getFriendSuggestions"
  );

  const response = await callable({});
  const suggestions = Array.isArray(response.data?.suggestions)
    ? response.data.suggestions
    : [];

  return suggestions
    .filter((item): item is FriendSuggestionDTO => typeof item?.uid === "string")
    .map((item) => ({
      profile: {
        uid: item.uid,
        displayName: typeof item.displayName === "string" ? item.displayName : "",
        classes: Array.isArray(item.classes)
          ? item.classes.filter((code) => typeof code === "string")
          : [],
      },
      sharedClasses: Array.isArray(item.sharedClasses)
        ? item.sharedClasses.filter((code) => typeof code === "string")
        : [],
    }));
}
