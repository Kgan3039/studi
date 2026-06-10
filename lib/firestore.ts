import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";

import { UW_STUDY_LOCATIONS } from "@/data/uw-study-locations";
import { sanitizeLocationRatingTags } from "@/data/location-rating-options";
import { findStudyLocationById } from "@/lib/catalog";
import { db } from "../firebaseConfig";
export const COLLECTIONS = {
  conversations: "conversations",
  locationRatings: "locationRatings",
  locations: "locations",
  reports: "reports",
  sessions: "sessions",
  userBlocks: "userBlocks",
  users: "users",
} as const;

/**
 * PUBLIC profile — readable by any verified UW user (rules, PR 4).
 * Contains nothing sensitive: no email, no socials, no availability.
 */
export type UserProfile = {
  uid: string;
  displayName: string;
  classes: string[];
};

export type StudySessionStatus = "cancelled" | "full" | "open";

// Session times are Firestore Timestamps (D4).
export type StudySession = {
  classId: string;
  endTime: Timestamp;
  hostId: string;
  locationId: string;
  participantIds: string[];
  sessionId: string;
  startTime: Timestamp;
  status: StudySessionStatus;
  title: string;
};

export type StudyLocation = {
  building: string;
  campusArea: string;
  locationId: string;
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

function buildDirectConversationKey(firstUserId: string, secondUserId: string) {
  return [firstUserId, secondUserId].sort().join("__");
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

function normalizeStudyLocation(
  locationId: string,
  location: Partial<Omit<StudyLocation, "locationId">>
): StudyLocation {
  const fallback = findStudyLocationById(locationId);

  return {
    building: location.building ?? fallback?.building ?? "UW-Madison",
    campusArea: location.campusArea ?? fallback?.campusArea ?? "Campus",
    locationId,
    name: location.name ?? fallback?.name ?? locationId,
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
    ...(data.displayName ? { displayName: data.displayName } : {}),
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

  const data = snapshot.data();

  return {
    uid: userId,
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    classes: Array.isArray(data.classes) ? data.classes.filter((c) => typeof c === "string") : [],
  };
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
      const data = docSnap.data();
      const profile: UserProfile = {
        uid: docSnap.id,
        displayName: typeof data.displayName === "string" ? data.displayName : "",
        classes: Array.isArray(data.classes) ? data.classes : [],
      };
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

async function deleteDocumentRefs(documentRefs: DocumentReference[]) {
  const batchSize = 400;

  for (let index = 0; index < documentRefs.length; index += batchSize) {
    const batch = writeBatch(db);

    for (const documentRef of documentRefs.slice(index, index + batchSize)) {
      batch.delete(documentRef);
    }

    await batch.commit();
  }
}

export async function deleteUserAccountData(userId: string) {
  const locationRatingsSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.locationRatings), where("userId", "==", userId))
  );
  await deleteDocumentRefs(locationRatingsSnapshot.docs.map((ratingDoc) => ratingDoc.ref));

  const userBlocksSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.userBlocks), where("blockerUserId", "==", userId))
  );
  await deleteDocumentRefs(userBlocksSnapshot.docs.map((blockDoc) => blockDoc.ref));

  const hostedSessionsSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.sessions), where("hostId", "==", userId))
  );
  await deleteDocumentRefs(hostedSessionsSnapshot.docs.map((sessionDoc) => sessionDoc.ref));

  const joinedSessionsSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.sessions), where("participantIds", "array-contains", userId))
  );

  await Promise.all(
    joinedSessionsSnapshot.docs
      .filter((sessionDoc) => (sessionDoc.data() as StudySession).hostId !== userId)
      .map((sessionDoc) =>
        updateDoc(sessionDoc.ref, {
          participantIds: arrayRemove(userId),
          updatedAt: serverTimestamp(),
        })
      )
  );

  const conversationsSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.conversations), where("participantIds", "array-contains", userId))
  );

  await Promise.all(
    conversationsSnapshot.docs.map((conversationDoc) =>
      updateDoc(conversationDoc.ref, {
        participantIds: arrayRemove(userId),
        updatedAt: serverTimestamp(),
      })
    )
  );

  await deleteDoc(doc(db, COLLECTIONS.users, userId));
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

    return [...mergedLocations.values()].sort((firstLocation, secondLocation) =>
      firstLocation.name.localeCompare(secondLocation.name)
    );
  } catch (error) {
    console.warn("Unable to load saved locations, using built-in UW study spots.", error);
    return getBuiltInStudyLocations();
  }
}

const SESSIONS_PAGE_SIZE = 50;

export async function getUpcomingSessions(options?: {
  classIds?: string[];
}): Promise<StudySession[]> {
  const now = Timestamp.now();
  // `in` queries cap at 10 entries; users with 11-12 classes see their first
  // 10 in the filtered view — the "All classes" view covers the gap.
  const classIds = (options?.classIds ?? []).slice(0, 10);

  const constraints =
    classIds.length > 0
      ? [
          where("classId", "in", classIds),
          where("startTime", ">=", now),
          orderBy("startTime", "asc"),
          limit(SESSIONS_PAGE_SIZE),
        ]
      : [
          where("startTime", ">=", now),
          orderBy("startTime", "asc"),
          limit(SESSIONS_PAGE_SIZE),
        ];

  const snapshot = await getDocs(query(collection(db, COLLECTIONS.sessions), ...constraints));
  const sessions: StudySession[] = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    sessions.push({
      sessionId: docSnap.id,
      classId: data.classId ?? "",
      hostId: data.hostId ?? "",
      locationId: data.locationId ?? "",
      title: data.title ?? "",
      startTime: data.startTime,
      endTime: data.endTime,
      participantIds: Array.isArray(data.participantIds) ? data.participantIds : [],
      status: data.status ?? "open",
    });
  });

  return sessions.filter((s) => s.status !== "cancelled");
}

export async function getSessionById(sessionId: string) {
  const sessionSnapshot = await getDoc(doc(db, COLLECTIONS.sessions, sessionId));

  if (!sessionSnapshot.exists()) {
    return null;
  }

  const session = {
    sessionId: sessionSnapshot.id,
    ...(sessionSnapshot.data() as Omit<StudySession, "sessionId">),
  };

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
      ? ({
          locationId: location.id,
          ...(location.data() as Omit<StudyLocation, "locationId">),
        } satisfies StudyLocation)
      : findStudyLocationById(session.locationId),
  } satisfies StudySessionListItem;
}

export async function joinSession(
  sessionId: string,
  userId: string
): Promise<"joined" | "already-joined"> {
  const sessionRef = doc(db, COLLECTIONS.sessions, sessionId);
  const snapshot = await getDoc(sessionRef);

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

  if (data.startTime instanceof Timestamp && data.startTime.toMillis() < Date.now()) {
    throw new Error("This session has already started.");
  }

  await updateDoc(sessionRef, {
    participantIds: arrayUnion(userId),
    updatedAt: serverTimestamp(),
  });

  return "joined";
}

export async function leaveSession(sessionId: string, userId: string) {
  await updateDoc(doc(db, COLLECTIONS.sessions, sessionId), {
    participantIds: arrayRemove(userId),
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
}): Promise<string> {
  const sessionRef = doc(collection(db, COLLECTIONS.sessions));

  await setDoc(sessionRef, {
    classId: input.classId,
    hostId: input.hostId,
    locationId: input.locationId,
    title: input.title.slice(0, 80),
    startTime: Timestamp.fromDate(input.startTime),
    endTime: Timestamp.fromDate(input.endTime),
    participantIds: [input.hostId],
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return sessionRef.id;
}

export async function getOrCreateDirectConversation(firstUserId: string, secondUserId: string) {
  const participantKey = buildDirectConversationKey(firstUserId, secondUserId);
  const conversationsSnapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.conversations),
      where("participantIds", "array-contains", firstUserId)
    )
  );
  const existingConversation = conversationsSnapshot.docs.find((conversationDoc) => {
    const data = conversationDoc.data() as Omit<DirectConversation, "conversationId">;
    return data.participantKey === participantKey;
  });

  if (existingConversation) {
    return existingConversation.id;
  }

  const conversationRef = await addDoc(collection(db, COLLECTIONS.conversations), {
    participantIds: [firstUserId, secondUserId].sort(),
    participantKey,
    lastMessagePreview: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
  });

  return conversationRef.id;
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

  await addDoc(collection(db, COLLECTIONS.conversations, conversationId, "messages"), {
    senderId,
    text: trimmedText,
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(db, COLLECTIONS.conversations, conversationId), {
    lastMessagePreview: trimmedText,
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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

export function subscribeToUserConversations(
  userId: string,
  listener: (conversations: ConversationListItem[]) => void
) {
  const conversationsQuery = query(
    collection(db, COLLECTIONS.conversations),
    where("participantIds", "array-contains", userId)
  );

  return onSnapshot(conversationsQuery, async (snapshot) => {
    const rawConversations = snapshot.docs
      .map((conversationDoc) => ({
        conversationId: conversationDoc.id,
        ...(conversationDoc.data() as Omit<DirectConversation, "conversationId">),
      }))

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
  });
}

export async function blockUser(blockerUserId: string, blockedUserId: string) {
  const blockId = `${blockerUserId}__${blockedUserId}`;

  await setDoc(doc(db, COLLECTIONS.userBlocks, blockId), {
    blockerUserId,
    blockedUserId,
    createdAt: serverTimestamp(),
  } satisfies UserBlock);
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
  await addDoc(collection(db, COLLECTIONS.reports), {
    reporterUserId,
    reportedUserId,
    reason: reason.trim(),
    details: details.trim().slice(0, 1000),
    context,
    createdAt: serverTimestamp(),
  });
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

  await setDoc(ratingRef, {
    locationId,
    userId,
    stars,
    tags: sanitizeLocationRatingTags(tags),
    createdAt: existing.exists() ? existing.data()?.createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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

export async function getLocationRatingAggregates() {
  const snapshot = await getDocs(collection(db, COLLECTIONS.locationRatings));
  const ratings = snapshot.docs
    .map((ratingDoc) => ratingDoc.data() as LocationRating)
    .filter((rating) => Number.isInteger(rating.stars) && rating.stars >= 1 && rating.stars <= 5);

  const byLocation = new Map<string, LocationRating[]>();

  for (const rating of ratings) {
    const existing = byLocation.get(rating.locationId) ?? [];
    existing.push(rating);
    byLocation.set(rating.locationId, existing);
  }

  const aggregates = new Map<string, LocationRatingAggregate>();

  for (const [locationId, locationRatings] of byLocation.entries()) {
    const totalRatings = locationRatings.length;
    const averageStars =
      locationRatings.reduce((sum, r) => sum + r.stars, 0) / totalRatings;

    const tagCounts = new Map<string, number>();
    for (const rating of locationRatings) {
      for (const tag of sanitizeLocationRatingTags(rating.tags)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    const reviewTags = [...tagCounts.entries()]
      .sort(([firstTag, firstCount], [secondTag, secondCount]) =>
        secondCount === firstCount
          ? firstTag.localeCompare(secondTag)
          : secondCount - firstCount
      )
      .map(([tag]) => tag);

    aggregates.set(locationId, {
      averageStars: Math.round(averageStars * 10) / 10,
      locationId,
      reviewTags,
      topTags: reviewTags.slice(0, 5),
      totalRatings,
    });
  }

  return aggregates;
}
