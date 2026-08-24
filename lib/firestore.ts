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
import {
  CatalogRequestError,
  isCatalogRequestCooldownActive,
} from "@/lib/catalog-request";
import { auth, db } from "../firebaseConfig";
import { track } from "./analytics";
import { assertAllowedUserGeneratedText } from "./content-moderation";
import { createBlockIdempotently } from "./idempotent-block";
import {
  CreateSessionValidationError,
  createWithStaleVerificationRetry,
} from "./session-create-retry";
export const COLLECTIONS = {
  catalogRequests: "catalogRequests",
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

type BoundIntervalRateLimitedAction =
  | "createSession"
  | "locationRating"
  | "reportUser"
  | "sendMessage"
  | "updateSession";

type RateLimitedAction =
  | BoundIntervalRateLimitedAction
  | "catalogRequest"
  | "createConversation"
  | "friendRequest";

function rateLimitDoc(userId: string, action: RateLimitedAction) {
  return doc(db, COLLECTIONS.rateLimits, userId, "actions", action);
}

/** Bind one limiter advance to exactly one Firestore resource path. */
function stageBoundRateLimit(
  batch: ReturnType<typeof writeBatch>,
  userId: string,
  action: BoundIntervalRateLimitedAction,
  resourcePath: string
) {
  batch.set(rateLimitDoc(userId, action), {
    lastResourceId: resourcePath,
    updatedAt: serverTimestamp(),
  });
}

/** Bind one friend-request limiter advance to one deterministic request id. */
export function stageFriendRequestRateLimit(
  batch: ReturnType<typeof writeBatch>,
  userId: string,
  requestId: string
) {
  batch.set(rateLimitDoc(userId, "friendRequest"), {
    lastRequestId: requestId,
    updatedAt: serverTimestamp(),
  });
}

function stageCatalogRequestRateLimit(
  batch: ReturnType<typeof writeBatch>,
  userId: string,
  requestId: string
) {
  batch.set(rateLimitDoc(userId, "catalogRequest"), {
    lastRequestId: requestId,
    updatedAt: serverTimestamp(),
  });
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
  lastMessageId?: string;
  lastMessagePreview: string;
  participantIds: string[];
  participantKey: string;
  updatedAt?: unknown;
};

export type ConversationMessage = {
  conversationId: string;
  createdAt?: unknown;
  editedAt?: unknown;
  messageId: string;
  originalText?: string;
  pending: boolean;
  senderId: string;
  text: string;
  unsentAt?: unknown;
};

/** Session group-chat message — same shape as a DM message (senderId, text,
 *  createdAt); sender names resolve from public profiles at render time, so
 *  nothing forgeable or stale is denormalized onto the doc. */
export type SessionMessage = {
  createdAt?: unknown;
  editedAt?: unknown;
  messageId: string;
  originalText?: string;
  /** True while the local optimistic write hasn't been acknowledged yet. */
  pending: boolean;
  senderId: string;
  sessionId: string;
  text: string;
  unsentAt?: unknown;
};

export type ChatThreadType = "direct" | "session";

export type ConversationListItem = DirectConversation & {
  otherParticipant: UserProfile | null;
};

export type GroupChatListItem = {
  endTime: Timestamp;
  sessionId: string;
  title: string;
  lastMessageAt: Timestamp;
};

/** An owner-scoped choice to retain an ended session chat. */
export type KeptSessionChat = {
  keptAt?: unknown;
  sessionId: string;
};

export type HiddenChat = {
  chatType: "group";
  removedAt?: unknown;
  threadId: string;
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
  if (data.displayName) {
    assertAllowedUserGeneratedText(data.displayName);
  }
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
  assertAllowedUserGeneratedText(trimmed);

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

  assertAllowedUserGeneratedText(major);
  assertAllowedUserGeneratedText(pronouns);
  assertAllowedUserGeneratedText(bio);

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

/**
 * The authoritative participant roster, and nothing else. Deliberately lighter
 * than getSessionById — no profile or location joins — because the pre-join
 * blocked-participant check runs on the tap and only needs uids.
 *
 * Returns null when the session no longer exists, and throws when the read
 * fails, so callers can tell "verified roster" from "could not check" and fail
 * closed on the latter.
 *
 * The field is returned raw and unvalidated on purpose — hence `unknown`. The
 * guarded-join core treats any malformed roster as unverifiable, and filtering
 * here would quietly launder a bad document into a "verified" one: dropping a
 * null out of [blockedUid, null] yields a roster that looks trustworthy and
 * isn't. Validation belongs in one place, next to the decision it protects.
 */
export async function getSessionParticipantIds(sessionId: string): Promise<unknown> {
  const snapshot = await getDoc(doc(db, COLLECTIONS.sessions, sessionId));

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data().participantIds;
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

/**
 * Updates the host-controlled session fields. Participant membership, host
 * ownership, status, and creation metadata stay untouched so Firestore rules
 * can enforce the edit as a narrow host-only mutation.
 */
export async function updateSession(
  sessionId: string,
  input: {
    hostId: string;
    classId: string;
    locationId: string;
    title: string;
    startTime: Date;
    endTime: Date;
    /** Seats including the host, 2–20. Omit to preserve a legacy unlimited session. */
    capacity?: number;
  }
) {
  if (
    input.capacity !== undefined &&
    (!Number.isInteger(input.capacity) ||
      input.capacity < SESSION_CAPACITY_MIN ||
      input.capacity > SESSION_CAPACITY_MAX)
  ) {
    throw new CreateSessionValidationError(
      `Choose a capacity between ${SESSION_CAPACITY_MIN} and ${SESSION_CAPACITY_MAX} seats.`
    );
  }

  const title = input.title.trim().slice(0, 80);
  if (!title) {
    throw new CreateSessionValidationError("Add a title before saving the session.");
  }
  assertAllowedUserGeneratedText(title);

  const update = {
    classId: input.classId.trim().toUpperCase(),
    locationId: input.locationId.trim(),
    title,
    startTime: Timestamp.fromDate(input.startTime),
    endTime: Timestamp.fromDate(input.endTime),
    updatedAt: serverTimestamp(),
    ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
  };

  const sessionRef = doc(db, COLLECTIONS.sessions, sessionId);
  const batch = writeBatch(db);

  batch.update(sessionRef, update);
  // Material session edits are new in this release and use a strict bound
  // 30-second limiter. Unlike Phase 1 actions, no legacy unbound shape exists.
  stageBoundRateLimit(batch, input.hostId, "updateSession", `sessions/${sessionId}`);
  await batch.commit();
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
  assertAllowedUserGeneratedText(input.title);
  if (
    !Number.isInteger(input.capacity) ||
    input.capacity < SESSION_CAPACITY_MIN ||
    input.capacity > SESSION_CAPACITY_MAX
  ) {
    throw new CreateSessionValidationError(
      `Choose a capacity between ${SESSION_CAPACITY_MIN} and ${SESSION_CAPACITY_MAX} seats.`
    );
  }

  const commitSession = async () => {
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
    stageBoundRateLimit(batch, input.hostId, "createSession", `sessions/${sessionRef.id}`);
    await batch.commit();

    return sessionRef.id;
  };

  // user.reload() can update User.emailVerified before the ID token carries
  // the matching claim. Refresh once only for that exact state; all rules,
  // validation, and the create-session rate limit still apply on retry.
  return createWithStaleVerificationRetry({
    attempt: commitSession,
    expectedUid: input.hostId,
    getCurrentUser: () => auth.currentUser,
    isPermissionDenied: (error) =>
      error instanceof FirebaseError && error.code === "permission-denied",
  });
}

// ---------------------------------------------------------------------------
// New-conversation quota (security audit H3). Starting a DM was the only
// abuse-prone create with no throttle at all, so one account could park a
// top-of-inbox row on every user in the beta. A minimum-interval throttle (the
// shape the other five actions use) bounds rate but not reach, so this uses a
// fixed 24h window with a hard cap instead.
//
// firestore.rules is the authoritative enforcement layer — these constants
// mirror conversationQuotaMax()/conversationQuotaWindow() there and exist so
// the client can fail fast with a precise message instead of surfacing a bare
// permission-denied. Change both together.
// ---------------------------------------------------------------------------

export const CONVERSATION_QUOTA_MAX = 10;
export const CONVERSATION_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
/** TTL horizon written on every counter write; rules accept a 24–72h band. */
const CONVERSATION_QUOTA_TTL_MS = 48 * 60 * 60 * 1000;

/** Thrown when the caller has no new-conversation quota left in the window. */
export class ConversationQuotaError extends Error {
  constructor() {
    // Deliberately does not disclose the cap or when it resets.
    super("You've started several new chats recently. Try again later.");
    this.name = "ConversationQuotaError";
  }
}

type ConversationQuotaDoc = {
  windowStart: unknown;
  count: unknown;
  lastConversationId?: unknown;
};

/**
 * Decide the next counter state from what the transaction actually read.
 *
 * Returns null when the quota is spent. Pure and exported so the rollout
 * can be reasoned about (and tested) without a Firestore round trip; the
 * server independently re-validates every transition, so a wrong answer here
 * is denied rather than trusted.
 */
export function nextConversationQuotaCount(
  existing: ConversationQuotaDoc | undefined,
  now: number
): number | null {
  const windowStart =
    existing?.windowStart instanceof Timestamp ? existing.windowStart.toMillis() : null;
  const count = typeof existing?.count === "number" ? existing.count : null;

  // No doc, an unreadable doc, or a fully expired window all start over at 1.
  if (windowStart === null || count === null || now - windowStart >= CONVERSATION_QUOTA_WINDOW_MS) {
    return 1;
  }

  return count >= CONVERSATION_QUOTA_MAX ? null : count + 1;
}

/**
 * The other person in a direct conversation. Entry points that arrive without
 * a name in the route (notifications, push deep links) use this so the thread
 * is never headed by a generic placeholder.
 */
export async function getConversationPartner(
  conversationId: string,
  currentUserId: string
): Promise<{ userId: string; profile: UserProfile | null } | null> {
  const conversationSnapshot = await getDoc(
    doc(db, COLLECTIONS.conversations, conversationId)
  );

  if (!conversationSnapshot.exists()) {
    return null;
  }

  const participantIds =
    (conversationSnapshot.data() as DirectConversation).participantIds ?? [];
  const otherUserId = participantIds.find(
    (participantId) => participantId !== currentUserId
  );

  if (!otherUserId) {
    return null;
  }

  const profiles = await getProfilesByIds([otherUserId]);

  return { userId: otherUserId, profile: profiles.get(otherUserId) ?? null };
}

export async function getOrCreateDirectConversation(
  currentUserId: string,
  otherUserId: string
): Promise<string> {
  if (currentUserId === otherUserId) {
    throw new Error("You can't start a conversation with yourself.");
  }

  const participantIds = [currentUserId, otherUserId].sort();
  // Conversation doc ID == participantKey: dedup is structural and the rules
  // (PR 4) enforce the invariant, so the duplicate-thread race is gone.
  const conversationId = buildParticipantKey(currentUserId, otherUserId);
  const conversationRef = doc(db, COLLECTIONS.conversations, conversationId);
  const quotaRef = rateLimitDoc(currentUserId, "createConversation");

  // A transaction, not a read-then-batch: the quota decision must be made
  // against the same snapshot that the write commits under. With a prior
  // getDoc, two taps racing (or a retry landing beside the original) could
  // both read count=n and both write count=n+1, spending one slot for two
  // conversations. Firestore re-runs this callback on contention, so every
  // attempt re-reads the counter and recomputes from fresh state.
  const runCreate = () => runTransaction(db, async (transaction) => {
    const existing = await transaction.get(conversationRef);

    // Reopening an existing thread is always free — it neither reads nor
    // consumes quota, and adds no inbox row for anyone.
    if (existing.exists()) {
      return false;
    }

    const quotaSnap = await transaction.get(quotaRef);
    const nextCount = nextConversationQuotaCount(
      quotaSnap.exists() ? (quotaSnap.data() as ConversationQuotaDoc) : undefined,
      Date.now()
    );

    if (nextCount === null) {
      throw new ConversationQuotaError();
    }

    transaction.set(conversationRef, {
      participantIds,
      participantKey: conversationId,
      lastMessagePreview: "",
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // windowStart is pinned to the server clock on a reset (rules require
    // == request.time) and carried forward verbatim on an increment, so the
    // window can never be backdated or restarted early.
    transaction.set(quotaRef, {
      windowStart:
        nextCount === 1 ? serverTimestamp() : (quotaSnap.data() as ConversationQuotaDoc).windowStart,
      count: nextCount,
      lastConversationId: conversationId,
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + CONVERSATION_QUOTA_TTL_MS),
    });

    return true;
  });

  let created: boolean;
  try {
    created = await runCreate();
  } catch (error) {
    // Tracked outside the transaction callback: Firestore re-runs that callback
    // on contention, and counting a retry as a separate block would inflate the
    // signal we tune the cap against.
    if (error instanceof ConversationQuotaError) {
      track("conversation_quota_blocked");
    }
    throw error;
  }

  if (created) {
    // Phase 2 is active. Retain the property as an operational assertion that
    // every successful new thread used the enforced counter transaction.
    track("conversation_started", { quota_written: true });
  }

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
  assertAllowedUserGeneratedText(trimmedText);

  const batch = writeBatch(db);
  const messageRef = doc(collection(db, COLLECTIONS.conversations, conversationId, "messages"));

  batch.set(messageRef, {
    senderId,
    text: trimmedText,
    createdAt: serverTimestamp(),
  });

  stageBoundRateLimit(
    batch,
    senderId,
    "sendMessage",
    `conversations/${conversationId}/messages/${messageRef.id}`
  );
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
    const messages = snapshot.docs.map((messageDoc) => {
      const data = messageDoc.data({ serverTimestamps: "estimate" });
      return {
        conversationId,
        messageId: messageDoc.id,
        pending: messageDoc.metadata.hasPendingWrites,
        senderId: typeof data.senderId === "string" ? data.senderId : "",
        text: typeof data.text === "string" ? data.text : "",
        createdAt: data.createdAt,
        editedAt: data.editedAt,
        originalText: typeof data.originalText === "string" ? data.originalText : undefined,
        unsentAt: data.unsentAt,
      };
    });

    listener(messages);
  });
}

function chatMessageRef(
  threadType: ChatThreadType,
  threadId: string,
  messageId: string
) {
  return threadType === "direct"
    ? doc(db, COLLECTIONS.conversations, threadId, "messages", messageId)
    : doc(db, COLLECTIONS.sessions, threadId, "messages", messageId);
}

function messageHideThreadKey(threadType: ChatThreadType, threadId: string) {
  return `${threadType}__${threadId}`;
}

function hiddenMessagesCollection(
  userId: string,
  threadType: ChatThreadType,
  threadId: string
) {
  return collection(
    db,
    COLLECTIONS.users,
    userId,
    "messageHides",
    messageHideThreadKey(threadType, threadId),
    "messages"
  );
}

/** Keeps one user's local deletion separate from the shared message document. */
export function subscribeToHiddenMessageIds(
  userId: string,
  threadType: ChatThreadType,
  threadId: string,
  listener: (messageIds: Set<string>) => void,
  onError?: (error: Error) => void
) {
  return onSnapshot(
    hiddenMessagesCollection(userId, threadType, threadId),
    (snapshot) => listener(new Set(snapshot.docs.map((messageDoc) => messageDoc.id))),
    onError
  );
}

export async function hideChatMessagesForUser(
  userId: string,
  threadType: ChatThreadType,
  threadId: string,
  messageIds: Iterable<string>
) {
  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);
  if (uniqueMessageIds.length === 0) {
    return;
  }

  // Leave headroom under Firestore's 500-operation batch limit for future
  // marker metadata without changing multi-select behavior.
  for (let index = 0; index < uniqueMessageIds.length; index += 400) {
    const batch = writeBatch(db);
    for (const messageId of uniqueMessageIds.slice(index, index + 400)) {
      batch.set(doc(hiddenMessagesCollection(userId, threadType, threadId), messageId), {
        hiddenAt: serverTimestamp(),
        messageId,
        threadId,
        threadType,
      });
    }
    await batch.commit();
  }

  track("messages_deleted_for_self", {
    count: uniqueMessageIds.length,
    thread_type: threadType,
  });
}

function messageTimestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

export async function editChatMessage(
  threadType: ChatThreadType,
  threadId: string,
  messageId: string,
  senderId: string,
  text: string
) {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error("An edited message can't be empty.");
  }
  if (trimmedText.length > 2000) {
    throw new Error("Messages can be up to 2,000 characters.");
  }
  assertAllowedUserGeneratedText(trimmedText);

  const messageRef = chatMessageRef(threadType, threadId, messageId);
  await runTransaction(db, async (transaction) => {
    const messageSnapshot = await transaction.get(messageRef);
    if (!messageSnapshot.exists()) {
      throw new Error("This message is no longer available.");
    }

    const message = messageSnapshot.data();
    if (message.senderId !== senderId || message.unsentAt) {
      throw new Error("This message can't be edited.");
    }
    if (Date.now() - messageTimestampMillis(message.createdAt) > 15 * 60 * 1000) {
      throw new Error("Messages can only be edited for 15 minutes.");
    }
    if (message.text === trimmedText) {
      throw new Error("Make a change before confirming your edit.");
    }

    transaction.update(messageRef, {
      editedAt: serverTimestamp(),
      originalText:
        typeof message.originalText === "string" ? message.originalText : message.text,
      text: trimmedText,
    });
  });

  track("message_edited", { thread_type: threadType });
}

export async function unsendChatMessage(
  threadType: ChatThreadType,
  threadId: string,
  messageId: string,
  senderId: string
) {
  const messageRef = chatMessageRef(threadType, threadId, messageId);
  await runTransaction(db, async (transaction) => {
    const messageSnapshot = await transaction.get(messageRef);
    if (!messageSnapshot.exists()) {
      throw new Error("This message is no longer available.");
    }

    const message = messageSnapshot.data();
    if (message.senderId !== senderId || message.unsentAt) {
      throw new Error("This message can't be unsent.");
    }
    if (Date.now() - messageTimestampMillis(message.createdAt) > 2 * 60 * 1000) {
      throw new Error("Messages can only be unsent for 2 minutes.");
    }

    transaction.update(messageRef, {
      editedAt: deleteField(),
      originalText: deleteField(),
      text: "",
      unsentAt: serverTimestamp(),
    });
  });

  track("message_unsent", { thread_type: threadType });
}

// ---------------------------------------------------------------------------
// Session group chat (PR: group chat). Messages live in
// sessions/{sessionId}/messages with the same doc shape as DM messages;
// rules gate everything on parent-session participation. The chat screen
// keeps a live window over the newest page and pages backwards on demand,
// so no unbounded reads.
// ---------------------------------------------------------------------------

export const SESSION_MESSAGES_PAGE_SIZE = 30;
/** Ended session chats stay active for two hours unless their participant saves them. */
export const SESSION_CHAT_GRACE_PERIOD_MS = 2 * 60 * 60 * 1000;

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
    editedAt: data.editedAt,
    originalText: typeof data.originalText === "string" ? data.originalText : undefined,
    unsentAt: data.unsentAt,
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
  assertAllowedUserGeneratedText(trimmedText);

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.sessions, sessionId, "messages", messageId), {
    senderId,
    text: trimmedText.slice(0, 2000),
    createdAt: serverTimestamp(),
  });
  stageBoundRateLimit(
    batch,
    senderId,
    "sendMessage",
    `sessions/${sessionId}/messages/${messageId}`
  );
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

const GROUP_CHAT_LIST_LIMIT = 50;

function mapGroupChatListItem(
  sessionId: string,
  data: Record<string, unknown>
): GroupChatListItem | null {
  const lastMessageAt = normalizeSessionTimestamp(data.lastMessageAt);
  if (!lastMessageAt) {
    return null;
  }

  const endTime = normalizeSessionTimestamp(data.endTime);
  // Every current session has an end time. Hide malformed legacy rows rather
  // than treating an unknown deadline as a chat that lives forever.
  if (!endTime) {
    return null;
  }

  return {
    endTime,
    sessionId,
    title: typeof data.title === "string" ? data.title : "Study Session",
    lastMessageAt,
  };
}

/** A one-off lookup used to bring saved chats back into the bounded inbox. */
export async function getGroupChatListItem(sessionId: string): Promise<GroupChatListItem | null> {
  const sessionDoc = await getDoc(doc(db, COLLECTIONS.sessions, sessionId));
  return sessionDoc.exists() ? mapGroupChatListItem(sessionId, sessionDoc.data()) : null;
}

/**
 * A bounded listener over the user's most recently active session chats.
 * orderBy(lastMessageAt) excludes sessions with zero messages without reading
 * message subcollections or exposing message text on the session document.
 */
export function subscribeToUserGroupChats(
  userId: string,
  listener: (groupChats: GroupChatListItem[]) => void,
  onError?: (error: Error) => void
) {
  const groupChatsQuery = query(
    collection(db, COLLECTIONS.sessions),
    where("participantIds", "array-contains", userId),
    orderBy("lastMessageAt", "desc"),
    limit(GROUP_CHAT_LIST_LIMIT)
  );

  return onSnapshot(
    groupChatsQuery,
    (snapshot) => {
      listener(
        snapshot.docs
          .map((sessionDoc) => mapGroupChatListItem(sessionDoc.id, sessionDoc.data()))
          .filter((chat): chat is GroupChatListItem => !!chat)
      );
    },
    onError
  );
}

/** Owner-only saved-chat markers, written while a session's grace window is open. */
export function subscribeToKeptSessionChats(
  userId: string,
  listener: (keptChats: Map<string, KeptSessionChat>) => void,
  onError?: (error: Error) => void
) {
  return onSnapshot(
    collection(db, COLLECTIONS.users, userId, "keptSessionChats"),
    (snapshot) => {
      const keptChats = new Map<string, KeptSessionChat>();

      snapshot.docs.forEach((keptChatDoc) => {
        const data = keptChatDoc.data({ serverTimestamps: "estimate" });
        keptChats.set(keptChatDoc.id, {
          keptAt: data.keptAt,
          sessionId: keptChatDoc.id,
        });
      });

      listener(keptChats);
    },
    onError
  );
}

export async function keepSessionChat(userId: string, sessionId: string) {
  await setDoc(doc(db, COLLECTIONS.users, userId, "keptSessionChats", sessionId), {
    keptAt: serverTimestamp(),
    sessionId,
  } satisfies KeptSessionChat);
}

/**
 * Personal session-chat removals. The shared session and its messages are
 * deliberately left untouched. Removal is sticky until the owner explicitly
 * deletes the marker.
 */
export function subscribeToHiddenChats(
  userId: string,
  listener: (hiddenChats: Map<string, HiddenChat>) => void,
  onError?: (error: Error) => void
) {
  return onSnapshot(
    query(
      collection(db, COLLECTIONS.users, userId, "hiddenChats"),
      where("chatType", "==", "group")
    ),
    (snapshot) => {
      const hiddenChats = new Map<string, HiddenChat>();

      snapshot.docs.forEach((hiddenChatDoc) => {
        const data = hiddenChatDoc.data({ serverTimestamps: "estimate" });
        if (
          data.chatType === "group" &&
          typeof data.threadId === "string"
        ) {
          hiddenChats.set(`${data.chatType}:${data.threadId}`, {
            chatType: data.chatType,
            threadId: data.threadId,
            removedAt: data.removedAt,
          });
        }
      });

      listener(hiddenChats);
    },
    onError
  );
}

export async function removeSessionChatFromUserHistory(
  userId: string,
  sessionId: string
) {
  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.users, userId, "hiddenChats", `group__${sessionId}`), {
    chatType: "group",
    threadId: sessionId,
    removedAt: serverTimestamp(),
  } satisfies HiddenChat);
  batch.set(doc(db, COLLECTIONS.users, userId, "reads", sessionId), {
    lastReadAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function blockUser(blockerUserId: string, blockedUserId: string) {
  const blockId = `${blockerUserId}__${blockedUserId}`;
  const blockRef = doc(db, COLLECTIONS.userBlocks, blockId);

  await createBlockIdempotently({
    blockerUserId,
    blockedUserId,
    writeBlock: () => setDoc(blockRef, {
      blockerUserId,
      blockedUserId,
      createdAt: serverTimestamp(),
    } satisfies UserBlock),
    readBlock: async () => {
      const snapshot = await getDoc(blockRef);
      return snapshot.exists() ? snapshot.data() : null;
    },
  });
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
  context: string,
  target?: { contentType: "direct_message" | "session_message"; contentId: string; threadId: string }
) {
  let messageText: string | undefined;
  if (target) {
    const messageRef = target.contentType === "direct_message"
      ? doc(db, COLLECTIONS.conversations, target.threadId, "messages", target.contentId)
      : doc(db, COLLECTIONS.sessions, target.threadId, "messages", target.contentId);
    const messageSnapshot = await getDoc(messageRef);
    const message = messageSnapshot.data();
    if (
      !messageSnapshot.exists()
      || typeof message?.senderId !== "string"
      || message.senderId !== reportedUserId
      || typeof message?.text !== "string"
    ) {
      throw new Error("Invalid report target.");
    }
    messageText = message.text;
  }

  const batch = writeBatch(db);
  const reportRef = doc(collection(db, COLLECTIONS.reports));

  batch.set(reportRef, {
    reporterUserId,
    reportedUserId,
    reason: reason.trim(),
    details: details.trim().slice(0, 1000),
    context,
    ...(target
      ? {
          contentType: target.contentType,
          contentId: target.contentId.slice(0, 128),
          threadId: target.threadId.slice(0, 128),
          messageText,
        }
      : {}),
    createdAt: serverTimestamp(),
  });
  stageBoundRateLimit(batch, reporterUserId, "reportUser", `reports/${reportRef.id}`);
  await batch.commit();
}

export type CatalogRequestType = "course" | "location";

export type CatalogRequestInput = {
  details: string;
  name: string;
  searchQuery: string;
  source: string;
  type: CatalogRequestType;
};

/** Write-only suggestions for missing courses and campus study spots. */
export async function submitCatalogRequest(userId: string, input: CatalogRequestInput) {
  const name = input.name.trim().slice(0, 120);
  const details = input.details.trim().slice(0, 500);
  const searchQuery = input.searchQuery.trim().slice(0, 120);
  const source = input.source.trim().slice(0, 40);

  if (!userId || name.length < 2 || !["course", "location"].includes(input.type)) {
    throw new CatalogRequestError("catalog-request/invalid");
  }

  const batch = writeBatch(db);
  const requestRef = doc(collection(db, COLLECTIONS.catalogRequests));
  const limiterRef = rateLimitDoc(userId, "catalogRequest");
  const limiterSnapshot = await getDoc(limiterRef);
  const limiterUpdatedAt = limiterSnapshot.data()?.updatedAt;

  if (
    limiterUpdatedAt instanceof Timestamp &&
    isCatalogRequestCooldownActive(limiterUpdatedAt.toMillis())
  ) {
    throw new CatalogRequestError("catalog-request/cooldown");
  }

  batch.set(requestRef, {
    requesterUserId: userId,
    type: input.type,
    name,
    searchQuery,
    details,
    source,
    createdAt: serverTimestamp(),
  });
  stageCatalogRequestRateLimit(batch, userId, requestRef.id);
  try {
    await batch.commit();
  } catch (error) {
    if (error instanceof FirebaseError && error.code === "permission-denied") {
      try {
        const latestLimiter = await getDoc(limiterRef);
        const latestUpdatedAt = latestLimiter.data()?.updatedAt;
        if (
          latestUpdatedAt instanceof Timestamp &&
          isCatalogRequestCooldownActive(latestUpdatedAt.toMillis())
        ) {
          throw new CatalogRequestError("catalog-request/cooldown");
        }
      } catch (cooldownCheckError) {
        if (cooldownCheckError instanceof CatalogRequestError) {
          throw cooldownCheckError;
        }
      }
    }
    throw error;
  }
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
  stageBoundRateLimit(
    batch,
    userId,
    "locationRating",
    `locationRatings/${ratingRef.id}`
  );
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

/**
 * Every spot this user has rated, keyed by the raw stored locationId. One query
 * instead of a per-spot `get`, so the spots list can show which places you've
 * already rated without a read per row. Callers canonicalize the ids — that
 * mapping lives in lib/catalog, which this module deliberately doesn't import.
 */
export async function getOwnLocationRatings(userId: string): Promise<Map<string, number>> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.locationRatings), where("userId", "==", userId))
  );

  const ratings = new Map<string, number>();

  for (const ratingDoc of snapshot.docs) {
    const rating = ratingDoc.data() as LocationRating;
    if (typeof rating.locationId === "string" && typeof rating.stars === "number") {
      ratings.set(rating.locationId, rating.stars);
    }
  }

  return ratings;
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
