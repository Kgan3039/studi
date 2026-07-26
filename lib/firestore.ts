import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { FirebaseError } from "firebase/app";

import {
  UW_STUDY_LOCATION_COORDINATE_OVERRIDES,
  UW_STUDY_LOCATIONS,
} from "@/data/uw-study-locations";
import { sanitizeLocationRatingTags } from "@/data/location-rating-options";
import { findStudyLocationById, formatStudyLocationLabel } from "@/lib/catalog";
import { db } from "../firebaseConfig";
import { track } from "./analytics";
export const COLLECTIONS = {
  conversations: "conversations",
  friendRequests: "friendRequests",
  friendships: "friendships",
  locationRatings: "locationRatings",
  locations: "locations",
  reports: "reports",
  rateLimits: "rateLimits",
  sessions: "sessions",
  userBlocks: "userBlocks",
  users: "users",
} as const;

type RateLimitedAction =
  | "createSession"
  | "friendRequest"
  | "locationRating"
  | "reportUser"
  | "sendMessage";

function rateLimitDoc(userId: string, action: RateLimitedAction) {
  return doc(db, COLLECTIONS.rateLimits, userId, "actions", action);
}

/** Exported for lib/friends.ts — every abuse-prone write batches one of these. */
export function stageRateLimit(
  batch: ReturnType<typeof writeBatch>,
  userId: string,
  action: RateLimitedAction
) {
  batch.set(rateLimitDoc(userId, action), { updatedAt: serverTimestamp() });
}

/**
 * PUBLIC profile — readable by any verified UW user (rules, PR 4).
 * Contains nothing sensitive: no email, no socials, no availability.
 * Academic fields (PR: expanded profiles) are optional — absent on docs
 * created before the fields existed and whenever the user clears them.
 */
export type UserProfile = {
  uid: string;
  displayName: string;
  classes: string[];
  year?: UserYear;
  major?: string;
  pronouns?: string;
  bio?: string;
};

export const USER_YEARS = ["Freshman", "Sophomore", "Junior", "Senior", "Grad"] as const;
export type UserYear = (typeof USER_YEARS)[number];

export const PROFILE_MAJOR_MAX_LENGTH = 60;
export const PROFILE_PRONOUNS_MAX_LENGTH = 20;
export const PROFILE_BIO_MAX_LENGTH = 140;

function isUserYear(value: unknown): value is UserYear {
  return typeof value === "string" && (USER_YEARS as readonly string[]).includes(value);
}

/** Exported for lib/friends.ts (search/suggestion query snapshots). */
export function parseUserProfile(uid: string, data: Record<string, unknown>): UserProfile {
  return {
    uid,
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    classes: Array.isArray(data.classes)
      ? data.classes.filter((c) => typeof c === "string")
      : [],
    ...(isUserYear(data.year) ? { year: data.year } : {}),
    ...(typeof data.major === "string" && data.major ? { major: data.major } : {}),
    ...(typeof data.pronouns === "string" && data.pronouns ? { pronouns: data.pronouns } : {}),
    ...(typeof data.bio === "string" && data.bio ? { bio: data.bio } : {}),
  };
}

export type StudySessionStatus = "cancelled" | "full" | "open";

// Session times are Firestore Timestamps (D4).
export type StudySession = {
  /** Seat ceiling including the host (2–20). Absent on pre-capacity sessions = unlimited. */
  capacity?: number;
  classId: string;
  endTime: Timestamp;
  hostId: string;
  /** Group-chat unread metadata, written only by the Cloud Function on each
   *  message — arrival time and sender, never content (the session doc is
   *  readable by all verified users). Absent until the first message. */
  lastMessageAt?: Timestamp;
  lastMessageSenderId?: string;
  locationId: string;
  participantIds: string[];
  sessionId: string;
  startTime: Timestamp;
  status: StudySessionStatus;
  title: string;
};

export const SESSION_CAPACITY_MIN = 2;
export const SESSION_CAPACITY_MAX = 20;
export const SESSION_CAPACITY_DEFAULT = 8;

/** A session is full when a capacity exists and every seat (host included) is taken. */
export function isSessionAtCapacity(session: Pick<StudySession, "capacity" | "participantIds">) {
  return (
    typeof session.capacity === "number" &&
    session.participantIds.length >= session.capacity
  );
}

/**
 * Thrown when a join loses the race for the last seat — the transaction
 * re-read the session and found it full. Callers show a friendly message and
 * refresh instead of treating it as an unexpected failure.
 */
export class SessionFullError extends Error {
  constructor() {
    super("This session just filled up — someone grabbed the last seat.");
    this.name = "SessionFullError";
  }
}

export type StudyLocation = {
  building: string;
  campusArea: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  locationId: string;
  mapPosition: {
    xPercent: number;
    yPercent: number;
  };
  name: string;
  notes: string;
  tags: string[];
};

export type StudySessionListItem = StudySession & {
  attendeeProfiles: UserProfile[];
  hostProfile?: UserProfile | null;
  location?: StudyLocation | null;
};

export type DirectConversation = {
  conversationId: string;
  createdAt?: unknown;
  lastMessageAt?: unknown;
  lastMessagePreview: string;
  participantIds: string[];
  participantKey: string;
  updatedAt?: unknown;
};

export type ConversationMessage = {
  conversationId: string;
  createdAt?: unknown;
  messageId: string;
  senderId: string;
  text: string;
};

/** Session group-chat message — same shape as a DM message (senderId, text,
 *  createdAt); sender names resolve from public profiles at render time, so
 *  nothing forgeable or stale is denormalized onto the doc. */
export type SessionMessage = {
  createdAt?: unknown;
  messageId: string;
  /** True while the local optimistic write hasn't been acknowledged yet. */
  pending: boolean;
  senderId: string;
  sessionId: string;
  text: string;
};

export type ConversationListItem = DirectConversation & {
  otherParticipant: UserProfile | null;
};

export type UserBlock = {
  blockedUserId: string;
  blockerUserId: string;
  createdAt?: unknown;
};

export type LocationRating = {
  createdAt?: unknown;
  locationId: string;
  stars: number;
  tags: string[];
  updatedAt?: unknown;
  userId: string;
};

export type LocationRatingAggregate = {
  averageStars: number;
  locationId: string;
  reviewTags: string[];
  topTags: string[];
  totalRatings: number;
};

export function buildParticipantKey(userA: string, userB: string) {
  return [userA, userB].sort().join("__");
}

function withBuiltInLocationFallback(location: StudyLocation): StudyLocation {
  const fallback = findStudyLocationById(location.locationId);

  if (!fallback) {
    return {
      ...location,
      tags: location.tags ?? [],
    };
  }

  return {
    ...fallback,
    ...location,
    tags: location.tags ?? fallback.tags,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeCoordinates(
  coordinates: Partial<StudyLocation["coordinates"]> | undefined,
  fallback: StudyLocation["coordinates"]
): StudyLocation["coordinates"] {
  return isFiniteNumber(coordinates?.latitude) && isFiniteNumber(coordinates?.longitude)
    ? {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      }
    : fallback;
}

function normalizeMapPosition(
  mapPosition: Partial<StudyLocation["mapPosition"]> | undefined,
  fallback: StudyLocation["mapPosition"]
): StudyLocation["mapPosition"] {
  const xPercent = isFiniteNumber(mapPosition?.xPercent)
    ? Math.min(100, Math.max(0, mapPosition.xPercent))
    : fallback.xPercent;
  const yPercent = isFiniteNumber(mapPosition?.yPercent)
    ? Math.min(100, Math.max(0, mapPosition.yPercent))
    : fallback.yPercent;

  return { xPercent, yPercent };
}

function isValidTimestampSecond(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= -62_135_596_800 &&
    value <= 253_402_300_799
  );
}

function normalizeTimestampNanoseconds(value: unknown) {
  return isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 1_000_000_000
    ? value
    : 0;
}

function normalizeStudyLocation(
  locationId: string,
  location: Partial<Omit<StudyLocation, "locationId">>
): StudyLocation {
  const fallback = findStudyLocationById(locationId);
  const fallbackCoordinates =
    fallback?.coordinates ??
    UW_STUDY_LOCATION_COORDINATE_OVERRIDES[locationId] ?? {
      latitude: 43.0731,
      longitude: -89.4012,
    };

  return {
    building: location.building ?? fallback?.building ?? "UW-Madison",
    campusArea: location.campusArea ?? fallback?.campusArea ?? "Campus",
    coordinates: normalizeCoordinates(location.coordinates, fallbackCoordinates),
    locationId,
    mapPosition: normalizeMapPosition(
      location.mapPosition,
      fallback?.mapPosition ?? { xPercent: 50, yPercent: 50 }
    ),
    // A stored name that just repeats the doc id is a slug, not a display
    // name — prefer the curated name (or a humanized label) instead.
    name:
      location.name && location.name.trim() && location.name.trim() !== locationId
        ? location.name.trim()
        : fallback?.name ?? formatStudyLocationLabel(locationId),
    notes: location.notes ?? fallback?.notes ?? "Study location on or near campus.",
    tags: Array.isArray(location.tags) ? location.tags : fallback?.tags ?? [],
  };
}

function getBuiltInStudyLocations() {
  return UW_STUDY_LOCATIONS.map((location) =>
    normalizeStudyLocation(location.locationId, location)
  ).sort((firstLocation, secondLocation) =>
    firstLocation.name.localeCompare(secondLocation.name)
  );
}

export async function createOrUpdateUserProfile(
  userId: string,
  data: { email: string; displayName?: string }
) {
  const publicRef = doc(db, COLLECTIONS.users, userId);
  const privateRef = doc(db, COLLECTIONS.users, userId, "private", "profile");
  const existing = await getDoc(publicRef);

  const publicPayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    ...(existing.exists() ? {} : { createdAt: serverTimestamp(), classes: [] }),
    // displayNameLower rides along with every displayName write (rules require
    // the pair to match) — it backs the case-insensitive friend search.
    ...(data.displayName
      ? {
          displayName: data.displayName,
          displayNameLower: data.displayName.toLowerCase(),
        }
      : {}),
  };

  await setDoc(publicRef, publicPayload, { merge: true });
  await setDoc(
    privateRef,
    { email: data.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(db, COLLECTIONS.users, userId));

  if (!snapshot.exists()) {
    return null;
  }

  return parseUserProfile(userId, snapshot.data());
}

// ---------------------------------------------------------------------------
// Profile batch fetch + short-lived cache.
// Replaces every per-uid getDoc loop (sessions list, session detail,
// conversation list). 10 uids per `in` query = 1 read per chunk member but a
// single round trip; the cache deduplicates across screens and snapshot
// re-fires.
// ---------------------------------------------------------------------------

const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<string, { profile: UserProfile | null; fetchedAt: number }>();

export function invalidateProfileCache(uid?: string) {
  if (uid) {
    profileCache.delete(uid);
    return;
  }
  profileCache.clear();
}

export async function getProfilesByIds(
  userIds: string[]
): Promise<Map<string, UserProfile | null>> {
  const result = new Map<string, UserProfile | null>();
  const now = Date.now();
  const missing: string[] = [];

  for (const uid of [...new Set(userIds)].filter(Boolean)) {
    const cached = profileCache.get(uid);
    if (cached && now - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
      result.set(uid, cached.profile);
    } else {
      missing.push(uid);
    }
  }

  for (let i = 0; i < missing.length; i += 10) {
    const chunk = missing.slice(i, i + 10);
    const snapshot = await getDocs(
      query(collection(db, COLLECTIONS.users), where(documentId(), "in", chunk))
    );

    const found = new Set<string>();
    snapshot.forEach((docSnap) => {
      const profile = parseUserProfile(docSnap.id, docSnap.data());
      profileCache.set(docSnap.id, { profile, fetchedAt: now });
      result.set(docSnap.id, profile);
      found.add(docSnap.id);
    });

    for (const uid of chunk) {
      if (!found.has(uid)) {
        profileCache.set(uid, { profile: null, fetchedAt: now });
        result.set(uid, null); // deleted user → render 'Student'
      }
    }
  }

  return result;
}

const MAX_CLASSES = 12;

export async function updateUserClasses(userId: string, classes: string[]) {
  const normalized = [
    ...new Set(
      classes
        .map((classCode) => classCode.trim().toUpperCase())
        .filter((classCode) => classCode.length > 0 && classCode.length <= 20)
    ),
  ];

  if (normalized.length > MAX_CLASSES) {
    throw new Error(`You can save up to ${MAX_CLASSES} classes.`);
  }

  await updateDoc(doc(db, COLLECTIONS.users, userId), {
    classes: normalized,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserDisplayName(userId: string, displayName: string) {
  const trimmed = displayName.trim();

  if (!trimmed || trimmed.length > 60) {
    throw new Error("Display name must be 1–60 characters.");
  }

  await updateDoc(doc(db, COLLECTIONS.users, userId), {
    displayName: trimmed,
    // Search shadow field — rules pin it to displayName.lower(), and legacy
    // docs gain it the first time the user re-saves their name.
    displayNameLower: trimmed.toLowerCase(),
    updatedAt: serverTimestamp(),
  });
  // Keep the Auth profile in sync so future profile writes can never resurrect
  // a stale name (the other half of the clobber fix; see lib/auth.ts caller note).
  const { updateProfile, getAuth } = await import("firebase/auth");
  const currentUser = getAuth().currentUser;
  if (currentUser && currentUser.uid === userId) {
    await updateProfile(currentUser, { displayName: trimmed });
  }
}

export type UserProfileDetails = {
  year: UserYear | null;
  major: string;
  pronouns: string;
  bio: string;
};

/**
 * Saves the optional academic fields. Blank values remove the field from the
 * doc (rules require present values to be non-empty), so cleared fields read
 * back as absent instead of ''.
 */
export async function updateUserProfileDetails(userId: string, details: UserProfileDetails) {
  const major = details.major.trim();
  const pronouns = details.pronouns.trim();
  const bio = details.bio.trim();

  if (major.length > PROFILE_MAJOR_MAX_LENGTH) {
    throw new Error(`Major must be ${PROFILE_MAJOR_MAX_LENGTH} characters or fewer.`);
  }
  if (pronouns.length > PROFILE_PRONOUNS_MAX_LENGTH) {
    throw new Error(`Pronouns must be ${PROFILE_PRONOUNS_MAX_LENGTH} characters or fewer.`);
  }
  if (bio.length > PROFILE_BIO_MAX_LENGTH) {
    throw new Error(`Bio must be ${PROFILE_BIO_MAX_LENGTH} characters or fewer.`);
  }

  await updateDoc(doc(db, COLLECTIONS.users, userId), {
    year: details.year ?? deleteField(),
    major: major || deleteField(),
    pronouns: pronouns || deleteField(),
    bio: bio || deleteField(),
    updatedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Settings — users/{uid}/private/settings (PR: settings + notification prefs).
// Owner-only. The doc only exists once the user flips a switch; a missing doc
// or missing key means the preference is enabled. The notify() pipeline
// (later PR) consults these before sending anything.
// ---------------------------------------------------------------------------

export const NOTIFICATION_PREF_KEYS = [
  "sessionReminders",
  "sessionActivity",
  "dmMessages",
  "groupMessages",
  "friendRequests",
] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];

export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  sessionReminders: true,
  sessionActivity: true,
  dmMessages: true,
  groupMessages: true,
  friendRequests: true,
};

function settingsDoc(userId: string) {
  return doc(db, COLLECTIONS.users, userId, "private", "settings");
}

/** Missing doc, missing keys, and non-boolean junk all fall back to enabled. */
export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const snapshot = await getDoc(settingsDoc(userId));
  const stored = snapshot.data()?.notificationPrefs as Record<string, unknown> | undefined;
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS };

  if (stored && typeof stored === "object") {
    for (const key of NOTIFICATION_PREF_KEYS) {
      if (typeof stored[key] === "boolean") {
        prefs[key] = stored[key];
      }
    }
  }

  return prefs;
}

/**
 * Persists one preference. Merge keeps the write minimal (only the toggled
 * key travels), creates the doc on first toggle, and can't clobber a
 * concurrent toggle of a different preference.
 */
export async function saveNotificationPref(
  userId: string,
  key: NotificationPrefKey,
  enabled: boolean
) {
  await setDoc(
    settingsDoc(userId),
    {
      notificationPrefs: { [key]: enabled },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Notification records (users/{uid}/notifications) — written only by Cloud
 * Functions; the client reads them and flips readAt. group_message /
 * friend_* types are reserved by the schema but not produced yet.
 */
export type AppNotification = {
  notificationId: string;
  /** One of the schema's 8 types; kept open so unknown future types render generically. */
  type: string;
  title: string;
  body: string;
  url: string;
  createdAt: Timestamp | null;
  readAt: Timestamp | null;
};

export const NOTIFICATIONS_PAGE_SIZE = 30;

function notificationsCollection(userId: string) {
  return collection(db, COLLECTIONS.users, userId, "notifications");
}

function parseNotification(id: string, data: Record<string, unknown>): AppNotification {
  return {
    notificationId: id,
    type: typeof data.type === "string" ? data.type : "unknown",
    title: typeof data.title === "string" ? data.title : "",
    body: typeof data.body === "string" ? data.body : "",
    url: typeof data.url === "string" ? data.url : "",
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
    readAt: data.readAt instanceof Timestamp ? data.readAt : null,
  };
}

export type NotificationsPage = {
  notifications: AppNotification[];
  /** Pass back to getNotificationsPage to fetch the next page; null when exhausted. */
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
};

/** Newest-first page; never an unbounded read. */
export async function getNotificationsPage(
  userId: string,
  cursor?: QueryDocumentSnapshot | null,
  pageSize = NOTIFICATIONS_PAGE_SIZE
): Promise<NotificationsPage> {
  // The header preview needs only a few rows. Keep callers from turning the
  // regular notification inbox into an accidental unbounded read.
  const safePageSize = Math.min(Math.max(pageSize, 1), NOTIFICATIONS_PAGE_SIZE);
  const snapshot = await getDocs(
    query(
      notificationsCollection(userId),
      orderBy("createdAt", "desc"),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(safePageSize)
    )
  );

  const hasMore = snapshot.size === safePageSize;

  return {
    notifications: snapshot.docs.map((d) => parseNotification(d.id, d.data())),
    cursor: hasMore ? snapshot.docs[snapshot.docs.length - 1] : null,
    hasMore,
  };
}

/** Aggregation count — no document reads, safe to call on every focus. */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const snapshot = await getCountFromServer(
    query(notificationsCollection(userId), where("readAt", "==", null))
  );
  return snapshot.data().count;
}

export async function markNotificationRead(userId: string, notificationId: string) {
  await updateDoc(doc(db, COLLECTIONS.users, userId, "notifications", notificationId), {
    readAt: serverTimestamp(),
  });
}

/**
 * Marks every unread notification read, paging well under the 500-write
 * batch cap. Touches only unread docs and only their readAt field.
 * Returns how many were updated.
 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const pageSize = 300;
  let total = 0;

  for (;;) {
    const snapshot = await getDocs(
      query(notificationsCollection(userId), where("readAt", "==", null), limit(pageSize))
    );

    if (snapshot.empty) {
      return total;
    }

    const batch = writeBatch(db);
    snapshot.docs.forEach((d) => batch.update(d.ref, { readAt: serverTimestamp() }));
    await batch.commit();
    total += snapshot.size;

    if (snapshot.size < pageSize) {
      return total;
    }
  }
}

export async function getLocations() {
  try {
    const locationsQuery = query(
      collection(db, COLLECTIONS.locations),
      orderBy("name")
    );
    const snapshot = await getDocs(locationsQuery);

    const storedLocations = snapshot.docs.map((locationDoc) =>
      normalizeStudyLocation(
        locationDoc.id,
        locationDoc.data() as Partial<Omit<StudyLocation, "locationId">>
      )
    );

    const mergedLocations = new Map<string, StudyLocation>();

    for (const location of getBuiltInStudyLocations()) {
      mergedLocations.set(location.locationId, location);
    }

    for (const location of storedLocations) {
      mergedLocations.set(location.locationId, withBuiltInLocationFallback(location));
    }

    // Firestore alias docs (e.g. `morgridge`) can carry the same display name
    // as a built-in spot under a different id, rendering as duplicate rows in
    // the location picker. Keep one entry per display name — built-ins are
    // inserted first, so the curated record (real map position, notes, tags)
    // wins over the alias.
    const dedupedByName = new Map<string, StudyLocation>();

    for (const location of mergedLocations.values()) {
      const nameKey = location.name.trim().toLowerCase();

      if (!dedupedByName.has(nameKey)) {
        dedupedByName.set(nameKey, location);
      }
    }

    return [...dedupedByName.values()].sort((firstLocation, secondLocation) =>
      firstLocation.name.localeCompare(secondLocation.name)
    );
  } catch (error) {
    // Permission-denied is the expected signed-out case (e.g. direct web URL
    // visits); the built-in list is the designed experience there, not a fault.
    const isPermissionDenied =
      error instanceof FirebaseError && error.code === "permission-denied";

    if (!isPermissionDenied) {
      console.warn("Unable to load saved locations, using built-in UW study spots.", error);
    }

    return getBuiltInStudyLocations();
  }
}

/**
 * Sessions are written with Firestore Timestamps (PR 5 migration), but legacy
 * docs may still carry ISO strings or Dates for startTime/endTime. Normalize
 * any of these into a Timestamp so UI code can safely call `.toDate()` /
 * `.toMillis()`. Returns null for anything we can't make sense of, letting
 * callers drop the field (or the whole session) instead of crashing.
 */
export function normalizeSessionTimestamp(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) {
    return value;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : Timestamp.fromDate(value);
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : Timestamp.fromDate(parsed);
  }

  // Plain {seconds, nanoseconds} shape — a Timestamp that lost its prototype
  // (e.g. revived from JSON or written by an older non-SDK path).
  if (
    value &&
    typeof value === "object" &&
    isValidTimestampSecond((value as { seconds?: unknown }).seconds)
  ) {
    const { seconds, nanoseconds } = value as { seconds: number; nanoseconds?: unknown };
    return new Timestamp(seconds, normalizeTimestampNanoseconds(nanoseconds));
  }

  return null;
}

/**
 * Maps a raw session doc into a typed StudySession, normalizing legacy
 * timestamp shapes. Returns null when start/end can't be normalized — such a
 * session can't be placed on any timeline, so callers drop it rather than let
 * `.toDate()` throw downstream.
 */
function normalizeSessionDoc(
  sessionId: string,
  data: Record<string, unknown>
): StudySession | null {
  const startTime = normalizeSessionTimestamp(data.startTime);
  const endTime = normalizeSessionTimestamp(data.endTime);

  if (!startTime || !endTime) {
    return null;
  }

  const lastMessageAt = normalizeSessionTimestamp(data.lastMessageAt);

  return {
    sessionId,
    classId: typeof data.classId === "string" ? data.classId : "",
    hostId: typeof data.hostId === "string" ? data.hostId : "",
    locationId: typeof data.locationId === "string" ? data.locationId : "",
    title: typeof data.title === "string" ? data.title : "",
    startTime,
    endTime,
    participantIds: Array.isArray(data.participantIds)
      ? data.participantIds.filter((id): id is string => typeof id === "string")
      : [],
    status: (data.status as StudySessionStatus) ?? "open",
    // Pre-capacity docs have no field — leave undefined (unlimited).
    ...(typeof data.capacity === "number" && Number.isInteger(data.capacity)
      ? { capacity: data.capacity }
      : {}),
    // Group-chat unread metadata (CF-written) — absent until the first message.
    ...(lastMessageAt ? { lastMessageAt } : {}),
    ...(typeof data.lastMessageSenderId === "string" && data.lastMessageSenderId
      ? { lastMessageSenderId: data.lastMessageSenderId }
      : {}),
  };
}

const SESSIONS_PAGE_SIZE = 50;

// How far back to scan for sessions that are still running. Rules allow
// sessions up to 12h (endTime < startTime + 12h), and manual end-time entry
// lets hosts exceed the 3h preset — scan the full window so no in-progress
// session drops off the "happening now" view.
const IN_PROGRESS_LOOKBACK_MS = 12 * 60 * 60 * 1000;

export async function getUpcomingSessions(options?: {
  classIds?: string[];
  /**
   * Also return sessions already underway (started within the lookback
   * window, not yet ended) — Today's "Happening now" hero. Defaults off so
   * existing callers keep the original future-only behavior.
   */
  includeInProgress?: boolean;
}): Promise<StudySession[]> {
  const now = Timestamp.now();
  const windowStart = options?.includeInProgress
    ? Timestamp.fromMillis(now.toMillis() - IN_PROGRESS_LOOKBACK_MS)
    : now;
  // `in` queries cap at 10 entries; users with 11-12 classes see their first
  // 10 in the filtered view — the "All classes" view covers the gap.
  const classIds = (options?.classIds ?? []).slice(0, 10);

  const constraints =
    classIds.length > 0
      ? [
          where("classId", "in", classIds),
          where("startTime", ">=", windowStart),
          orderBy("startTime", "asc"),
          limit(SESSIONS_PAGE_SIZE),
        ]
      : [
          where("startTime", ">=", windowStart),
          orderBy("startTime", "asc"),
          limit(SESSIONS_PAGE_SIZE),
        ];

  const sessions = await fetchSessionDocs(constraints);

  return filterActiveSessions(sessions, now.toMillis(), options?.includeInProgress);
}

async function fetchSessionDocs(
  constraints: QueryConstraint[]
): Promise<StudySession[]> {
  const snapshot = await getDocs(query(collection(db, COLLECTIONS.sessions), ...constraints));
  const sessions: StudySession[] = [];

  snapshot.forEach((docSnap) => {
    // Legacy docs with unparseable start/end normalize to null and are dropped
    // here rather than crashing the list when the UI calls `.toMillis()`.
    const session = normalizeSessionDoc(docSnap.id, docSnap.data());
    if (session) {
      sessions.push(session);
    }
  });

  return sessions;
}

function filterActiveSessions(
  sessions: StudySession[],
  cutoffMs: number,
  includeInProgress?: boolean
): StudySession[] {
  return sessions.filter((s) => {
    if (s.status === "cancelled") {
      return false;
    }
    if (!includeInProgress) {
      return true;
    }
    // With the widened window, drop sessions that already ended; keep future
    // ones regardless (missing/odd endTime data must not hide them).
    const startsInFuture = s.startTime.toMillis() >= cutoffMs;
    const stillRunning = !!s.endTime && s.endTime.toMillis() > cutoffMs;
    return startsInFuture || stillRunning;
  });
}

// Firestore `in` disjunctions cap at 10 values, so class lists are chunked
// into parallel queries and the pages merged client-side.
const CLASS_ID_CHUNK_SIZE = 10;

/**
 * Today feed data path: fetch sessions for the user's enrolled classes
 * directly (chunked `classId in` queries) plus anything the user already
 * joined, instead of scanning the global list and filtering client-side.
 */
export async function getUpcomingSessionsForClasses(options: {
  classIds: string[];
  /** Also include sessions this user already joined, whatever the class. */
  participantId?: string;
  includeInProgress?: boolean;
}): Promise<StudySession[]> {
  const now = Timestamp.now();
  const windowStart = options.includeInProgress
    ? Timestamp.fromMillis(now.toMillis() - IN_PROGRESS_LOOKBACK_MS)
    : now;
  const timeConstraints = [
    where("startTime", ">=", windowStart),
    orderBy("startTime", "asc"),
    limit(SESSIONS_PAGE_SIZE),
  ];

  const classIds = [...new Set(options.classIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < classIds.length; i += CLASS_ID_CHUNK_SIZE) {
    chunks.push(classIds.slice(i, i + CLASS_ID_CHUNK_SIZE));
  }

  const reads = chunks.map((chunk) =>
    fetchSessionDocs([where("classId", "in", chunk), ...timeConstraints])
  );
  if (options.participantId) {
    reads.push(
      fetchSessionDocs([
        where("participantIds", "array-contains", options.participantId),
        ...timeConstraints,
      ])
    );
  }

  const pages = await Promise.all(reads);

  // Merge by sessionId: a session can appear in both its class chunk and the
  // joined-sessions page.
  const byId = new Map<string, StudySession>();
  for (const page of pages) {
    for (const session of page) {
      byId.set(session.sessionId, session);
    }
  }

  return filterActiveSessions([...byId.values()], now.toMillis(), options.includeInProgress)
    .sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis())
    .slice(0, SESSIONS_PAGE_SIZE);
}

export async function getSessionById(sessionId: string) {
  const sessionSnapshot = await getDoc(doc(db, COLLECTIONS.sessions, sessionId));

  if (!sessionSnapshot.exists()) {
    return null;
  }

  // Drop legacy/broken docs whose timestamps can't be normalized — the detail
  // screen treats a null result as "no longer exists" instead of crashing.
  const session = normalizeSessionDoc(sessionSnapshot.id, sessionSnapshot.data());
  if (!session) {
    return null;
  }

  const [location, profilesById] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.locations, session.locationId)),
    getProfilesByIds([session.hostId, ...session.participantIds]),
  ]);

  return {
    ...session,
    attendeeProfiles: session.participantIds
      .map((participantId) => profilesById.get(participantId))
      .filter((participant): participant is UserProfile => !!participant),
    hostProfile: profilesById.get(session.hostId) ?? null,
    location: location.exists()
      ? // Normalize rather than spreading the raw doc — alias docs (e.g.
        // `morgridge`) may lack a display name, and normalization backfills
        // it from the curated record so the UI never shows the id.
        normalizeStudyLocation(
          location.id,
          location.data() as Partial<Omit<StudyLocation, "locationId">>
        )
      : findStudyLocationById(session.locationId),
  } satisfies StudySessionListItem;
}

/**
 * Joins inside a transaction so the read (seat count) and the write (seat
 * claim) are atomic: when two users race for the last seat the loser's
 * transaction re-reads the now-full session and throws SessionFullError
 * instead of over-filling. Rules re-enforce the same ceiling server-side.
 */
export async function joinSession(
  sessionId: string,
  userId: string
): Promise<"joined" | "already-joined"> {
  const sessionRef = doc(db, COLLECTIONS.sessions, sessionId);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(sessionRef);

    if (!snapshot.exists()) {
      throw new Error("This session no longer exists.");
    }

    const data = snapshot.data();
    const participantIds: string[] = Array.isArray(data.participantIds)
      ? data.participantIds
      : [];

    if (participantIds.includes(userId)) {
      return "already-joined"; // already in — silent no-op instead of a scary error
    }

    if (data.status !== "open") {
      throw new Error("This session is no longer open.");
    }

    const startTime = normalizeSessionTimestamp(data.startTime);
    if (startTime && startTime.toMillis() < Date.now()) {
      throw new Error("This session has already started.");
    }

    if (isSessionAtCapacity({ capacity: data.capacity, participantIds })) {
      throw new SessionFullError();
    }

    transaction.update(sessionRef, {
      participantIds: arrayUnion(userId),
      updatedAt: serverTimestamp(),
    });

    return "joined";
  });
}

export async function leaveSession(sessionId: string, userId: string) {
  await updateDoc(doc(db, COLLECTIONS.sessions, sessionId), {
    participantIds: arrayRemove(userId),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Marks a session cancelled. Thin wrapper over the existing host-edit rule
 * path (isHostEdit allows the host to set status: 'cancelled'); no new backend
 * behavior. Rules reject this for anyone but the host.
 */
export async function cancelSession(sessionId: string) {
  await updateDoc(doc(db, COLLECTIONS.sessions, sessionId), {
    status: "cancelled",
    updatedAt: serverTimestamp(),
  });
}

export async function createSession(input: {
  classId: string;
  hostId: string;
  locationId: string;
  title: string;
  startTime: Date;
  endTime: Date;
  /** Seats including the host, 2–20. */
  capacity: number;
}): Promise<string> {
  if (
    !Number.isInteger(input.capacity) ||
    input.capacity < SESSION_CAPACITY_MIN ||
    input.capacity > SESSION_CAPACITY_MAX
  ) {
    throw new Error(
      `Choose a capacity between ${SESSION_CAPACITY_MIN} and ${SESSION_CAPACITY_MAX} seats.`
    );
  }

  const sessionRef = doc(collection(db, COLLECTIONS.sessions));
  const batch = writeBatch(db);

  batch.set(sessionRef, {
    classId: input.classId,
    hostId: input.hostId,
    locationId: input.locationId,
    title: input.title.slice(0, 80),
    startTime: Timestamp.fromDate(input.startTime),
    endTime: Timestamp.fromDate(input.endTime),
    participantIds: [input.hostId],
    status: "open",
    capacity: input.capacity,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  stageRateLimit(batch, input.hostId, "createSession");
  await batch.commit();

  return sessionRef.id;
}

export async function getOrCreateDirectConversation(
  currentUserId: string,
  otherUserId: string
): Promise<string> {
  if (currentUserId === otherUserId) {
    throw new Error("You can't start a conversation with yourself.");
  }

  const participantIds = [currentUserId, otherUserId].sort();
  // Conversation doc ID == participantKey: dedup is a one-read getDoc and the
  // rules (PR 4) enforce the invariant, so the duplicate-thread race is gone.
  const conversationId = buildParticipantKey(currentUserId, otherUserId);
  const conversationRef = doc(db, COLLECTIONS.conversations, conversationId);
  const existing = await getDoc(conversationRef);

  if (existing.exists()) {
    return conversationId;
  }

  await setDoc(conversationRef, {
    participantIds,
    participantKey: conversationId,
    lastMessagePreview: "",
    lastMessageAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  track("conversation_started");

  return conversationId;
}

export async function sendDirectMessage(
  conversationId: string,
  senderId: string,
  text: string
) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error("Write a message before sending.");
  }

  const batch = writeBatch(db);
  const messageRef = doc(collection(db, COLLECTIONS.conversations, conversationId, "messages"));

  batch.set(messageRef, {
    senderId,
    text: trimmedText,
    createdAt: serverTimestamp(),
  });

  batch.update(doc(db, COLLECTIONS.conversations, conversationId), {
    // Rules cap the preview at 200 chars; messages themselves go up to 2000.
    lastMessagePreview: trimmedText.slice(0, 200),
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  stageRateLimit(batch, senderId, "sendMessage");
  await batch.commit();
  track("message_sent", { length: trimmedText.length });
}

export function subscribeToConversationMessages(
  conversationId: string,
  listener: (messages: ConversationMessage[]) => void
) {
  const messagesQuery = query(
    collection(db, COLLECTIONS.conversations, conversationId, "messages"),
    orderBy("createdAt", "asc")
  );

  return onSnapshot(messagesQuery, (snapshot) => {
    const messages = snapshot.docs.map((messageDoc) => ({
      conversationId,
      messageId: messageDoc.id,
      ...(messageDoc.data() as Omit<ConversationMessage, "conversationId" | "messageId">),
    }));

    listener(messages);
  });
}

// ---------------------------------------------------------------------------
// Session group chat (PR: group chat). Messages live in
// sessions/{sessionId}/messages with the same doc shape as DM messages;
// rules gate everything on parent-session participation. The chat screen
// keeps a live window over the newest page and pages backwards on demand,
// so no unbounded reads.
// ---------------------------------------------------------------------------

export const SESSION_MESSAGES_PAGE_SIZE = 30;

/** Group-chat fanout ceiling, judged on the ACTUAL participant count (the
 *  optional capacity field can be absent on legacy sessions). Mirrors
 *  firestore.rules (messages create) and MAX_GROUP_CHAT_PARTICIPANTS in
 *  functions/notification-validation.js — change all three together. */
export const MAX_GROUP_CHAT_PARTICIPANTS = 20;

/** Oversized legacy sessions get a read-only chat: rules deny new sends and
 *  the Cloud Function skips notification fanout entirely. */
export function isGroupChatAvailable(session: Pick<StudySession, "participantIds">) {
  return session.participantIds.length <= MAX_GROUP_CHAT_PARTICIPANTS;
}

function sessionMessagesCollection(sessionId: string) {
  return collection(db, COLLECTIONS.sessions, sessionId, "messages");
}

function mapSessionMessageDoc(
  sessionId: string,
  messageDoc: QueryDocumentSnapshot
): SessionMessage {
  // Estimated server timestamps keep an in-flight optimistic send ordered and
  // renderable instead of surfacing createdAt: null until the ack arrives.
  const data = messageDoc.data({ serverTimestamps: "estimate" });

  return {
    sessionId,
    messageId: messageDoc.id,
    pending: messageDoc.metadata.hasPendingWrites,
    senderId: typeof data.senderId === "string" ? data.senderId : "",
    text: typeof data.text === "string" ? data.text : "",
    createdAt: data.createdAt,
  };
}

/** Pre-generates the message doc ID so a failed send can be retried under the
 *  same ID without ever duplicating on screen or in Firestore. */
export function createSessionMessageId(sessionId: string): string {
  return doc(sessionMessagesCollection(sessionId)).id;
}

export async function sendSessionMessage(
  sessionId: string,
  senderId: string,
  text: string,
  messageId: string
) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error("Write a message before sending.");
  }

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.sessions, sessionId, "messages", messageId), {
    senderId,
    text: trimmedText.slice(0, 2000),
    createdAt: serverTimestamp(),
  });
  stageRateLimit(batch, senderId, "sendMessage");
  await batch.commit();
  track("group_message_sent", { length: trimmedText.length });
}

export type SessionMessagesPage = {
  /** Newest-first, matching the inverted chat list. */
  messages: SessionMessage[];
  /** Cursor for the next-older page; null when this page came up short. */
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
};

/**
 * Live window over the newest page of messages (newest-first). Local sends
 * appear immediately via latency compensation (`pending: true`) and settle in
 * place when the server acks. Older history loads through
 * getEarlierSessionMessages using the returned cursor.
 */
export function subscribeToSessionMessages(
  sessionId: string,
  listener: (page: SessionMessagesPage) => void,
  onError?: (error: Error) => void
) {
  const messagesQuery = query(
    sessionMessagesCollection(sessionId),
    orderBy("createdAt", "desc"),
    limit(SESSION_MESSAGES_PAGE_SIZE)
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const hasFullPage = snapshot.docs.length === SESSION_MESSAGES_PAGE_SIZE;
      listener({
        messages: snapshot.docs.map((messageDoc) =>
          mapSessionMessageDoc(sessionId, messageDoc)
        ),
        cursor: hasFullPage ? snapshot.docs[snapshot.docs.length - 1] : null,
        hasMore: hasFullPage,
      });
    },
    onError
  );
}

export async function getEarlierSessionMessages(
  sessionId: string,
  cursor: QueryDocumentSnapshot
): Promise<SessionMessagesPage> {
  const snapshot = await getDocs(
    query(
      sessionMessagesCollection(sessionId),
      orderBy("createdAt", "desc"),
      startAfter(cursor),
      limit(SESSION_MESSAGES_PAGE_SIZE)
    )
  );

  const hasFullPage = snapshot.docs.length === SESSION_MESSAGES_PAGE_SIZE;
  return {
    messages: snapshot.docs.map((messageDoc) => mapSessionMessageDoc(sessionId, messageDoc)),
    cursor: hasFullPage ? snapshot.docs[snapshot.docs.length - 1] : null,
    hasMore: hasFullPage,
  };
}

/** Records "I've seen this thread as of now" — rules pin the value to the
 *  server clock. threadId is the sessionId for group chats. */
export async function markSessionChatRead(userId: string, sessionId: string) {
  await setDoc(doc(db, COLLECTIONS.users, userId, "reads", sessionId), {
    lastReadAt: serverTimestamp(),
  });
}

export async function getSessionChatLastReadAt(
  userId: string,
  sessionId: string
): Promise<Timestamp | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.users, userId, "reads", sessionId));
  const lastReadAt = snap.exists() ? snap.data()?.lastReadAt : null;
  return lastReadAt instanceof Timestamp ? lastReadAt : null;
}

/** Unread = someone else's message arrived after the viewer's read marker.
 *  Your own sends never count, so the indicator can't flag you for talking. */
export function hasUnreadSessionChat(
  session: Pick<StudySession, "lastMessageAt" | "lastMessageSenderId">,
  currentUserId: string,
  lastReadAt: Timestamp | null
): boolean {
  if (!session.lastMessageAt || session.lastMessageSenderId === currentUserId) {
    return false;
  }
  return !lastReadAt || session.lastMessageAt.toMillis() > lastReadAt.toMillis();
}

export function subscribeToUserConversations(
  userId: string,
  listener: (conversations: ConversationListItem[]) => void,
  onError?: (error: Error) => void
) {
  const conversationsQuery = query(
    collection(db, COLLECTIONS.conversations),
    where("participantIds", "array-contains", userId)
  );

  return onSnapshot(
    conversationsQuery,
    async (snapshot) => {
      try {
        const rawConversations = snapshot.docs.map((conversationDoc) => ({
          conversationId: conversationDoc.id,
          ...(conversationDoc.data() as Omit<DirectConversation, "conversationId">),
        }));

        const otherUserIds = rawConversations.flatMap((conversation) =>
          conversation.participantIds.filter((participantId) => participantId !== userId)
        );
        const profilesById = await getProfilesByIds(otherUserIds);

        const conversations = rawConversations
          .map((conversation) => {
            const otherParticipantId =
              conversation.participantIds.find((participantId) => participantId !== userId) ?? "";

            return {
              ...conversation,
              otherParticipant: profilesById.get(otherParticipantId) ?? null,
            } satisfies ConversationListItem;
          })
          .sort((firstConversation, secondConversation) => {
            const firstTimestamp = firstConversation.updatedAt instanceof Timestamp
              ? firstConversation.updatedAt.toMillis()
              : 0;
            const secondTimestamp = secondConversation.updatedAt instanceof Timestamp
              ? secondConversation.updatedAt.toMillis()
              : 0;

            return secondTimestamp - firstTimestamp;
          });

        listener(conversations);
      } catch (error) {
        // Profile hydration runs inside the snapshot handler, so its rejection
        // never reaches onSnapshot's own error channel.
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    onError
  );
}

export async function blockUser(blockerUserId: string, blockedUserId: string) {
  const blockId = `${blockerUserId}__${blockedUserId}`;

  await setDoc(doc(db, COLLECTIONS.userBlocks, blockId), {
    blockerUserId,
    blockedUserId,
    createdAt: serverTimestamp(),
  } satisfies UserBlock);
}

export async function unblockUser(blockerUserId: string, blockedUserId: string) {
  const blockId = `${blockerUserId}__${blockedUserId}`;

  await deleteDoc(doc(db, COLLECTIONS.userBlocks, blockId));
}

export async function isBlockedByUser(userId: string, possibleBlockerUserId: string) {
  const blockId = `${possibleBlockerUserId}__${userId}`;
  const snapshot = await getDoc(doc(db, COLLECTIONS.userBlocks, blockId));

  return snapshot.exists();
}

export async function getBlockedUserIds(blockerUserId: string) {
  const blocksQuery = query(
    collection(db, COLLECTIONS.userBlocks),
    where("blockerUserId", "==", blockerUserId)
  );
  const snapshot = await getDocs(blocksQuery);

  return snapshot.docs.map((blockDoc) => (blockDoc.data() as UserBlock).blockedUserId);
}

export async function reportUser(
  reporterUserId: string,
  reportedUserId: string,
  reason: string,
  details: string,
  context: string
) {
  const batch = writeBatch(db);
  const reportRef = doc(collection(db, COLLECTIONS.reports));

  batch.set(reportRef, {
    reporterUserId,
    reportedUserId,
    reason: reason.trim(),
    details: details.trim().slice(0, 1000),
    context,
    createdAt: serverTimestamp(),
  });
  stageRateLimit(batch, reporterUserId, "reportUser");
  await batch.commit();
}

export async function submitLocationRating(
  locationId: string,
  userId: string,
  stars: number,
  tags: string[]
) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new Error("Choose a rating from 1 to 5 stars.");
  }

  const ratingRef = doc(db, COLLECTIONS.locationRatings, `${locationId}__${userId}`);
  const existing = await getDoc(ratingRef);
  const batch = writeBatch(db);

  batch.set(ratingRef, {
    locationId,
    userId,
    stars,
    tags: sanitizeLocationRatingTags(tags),
    createdAt: existing.exists() ? existing.data()?.createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  stageRateLimit(batch, userId, "locationRating");
  await batch.commit();
}

export async function getUserLocationRating(locationId: string, userId: string) {
  const snapshot = await getDoc(
    doc(db, COLLECTIONS.locationRatings, `${locationId}__${userId}`)
  );

  if (!snapshot.exists()) {
    return null;
  }

  const rating = snapshot.data() as LocationRating;

  return {
    ...rating,
    tags: sanitizeLocationRatingTags(rating.tags),
  };
}

// Aggregates are precomputed on the location docs by the onRatingWritten
// Cloud Function (ratingCount / ratingSum / tagCounts) — reading them costs
// `locations.length` reads and zero ratings reads, replacing the old
// full-collection scan of locationRatings.
function readAggregateFromLocationDoc(data: Record<string, unknown>) {
  const ratingCount = typeof data.ratingCount === "number" ? data.ratingCount : 0;
  const ratingSum = typeof data.ratingSum === "number" ? data.ratingSum : 0;

  return {
    ratingCount,
    averageStars: ratingCount > 0 ? ratingSum / ratingCount : null,
    tagCounts:
      data.tagCounts && typeof data.tagCounts === "object"
        ? (data.tagCounts as Record<string, number>)
        : {},
  };
}

export async function getLocationRatingAggregates() {
  const snapshot = await getDocs(collection(db, COLLECTIONS.locations));
  const aggregates = new Map<string, LocationRatingAggregate>();

  snapshot.forEach((locationDoc) => {
    const { ratingCount, averageStars, tagCounts } = readAggregateFromLocationDoc(
      locationDoc.data()
    );

    if (ratingCount === 0 || averageStars === null) {
      return;
    }

    const reviewTags = Object.entries(tagCounts)
      .filter(([, count]) => typeof count === "number" && count > 0)
      .sort(([firstTag, firstCount], [secondTag, secondCount]) =>
        secondCount === firstCount
          ? firstTag.localeCompare(secondTag)
          : secondCount - firstCount
      )
      .map(([tag]) => tag);

    aggregates.set(locationDoc.id, {
      averageStars: Math.round(averageStars * 10) / 10,
      locationId: locationDoc.id,
      reviewTags: sanitizeLocationRatingTags(reviewTags),
      topTags: sanitizeLocationRatingTags(reviewTags).slice(0, 5),
      totalRatings: ratingCount,
    });
  });

  return aggregates;
}
