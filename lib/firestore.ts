import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { UW_STUDY_LOCATIONS } from "@/data/uw-study-locations";
import { findStudyLocationById } from "@/lib/catalog";
import { db } from "../firebaseConfig";
import { validateSessionSchedule } from "./session-schedule";

export const COLLECTIONS = {
  conversations: "conversations",
  locationRatings: "locationRatings",
  locations: "locations",
  reports: "reports",
  sessions: "sessions",
  userBlocks: "userBlocks",
  users: "users",
} as const;

export type AvailabilityDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type AvailabilitySlot = {
  date?: string;
  day: AvailabilityDay;
  endMinutes: number;
  startMinutes: number;
};

export type Socials = {
  phone: string;
  instagram: string;
  snapchat: string;
  discord: string;
};

export type UserProfile = {
  availability: AvailabilitySlot[];
  classes: string[];
  createdAt?: unknown;
  displayName: string;
  email: string;
  lastLoginAt?: unknown;
  photoURL: string;
  socials?: Socials;
  uid: string;
  updatedAt?: unknown;
};

export type StudySessionStatus = "cancelled" | "full" | "open";

export type StudySession = {
  classId: string;
  createdAt?: unknown;
  endTime: string;
  hostId: string;
  locationId: string;
  participantIds: string[];
  sessionId: string;
  startTime: string;
  status: StudySessionStatus;
  title: string;
  updatedAt?: unknown;
};

export type StudyLocation = {
  building: string;
  campusArea: string;
  locationId: string;
  name: string;
  notes: string;
  tags: string[];
};

export type PotentialMatch = {
  availabilityOverlap: AvailabilitySlot[];
  sharedClasses: string[];
  user: UserProfile;
};

export type StudySessionListItem = StudySession & {
  attendeeProfiles: UserProfile[];
  hostEmail?: string;
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
  topTags: string[];
  totalRatings: number;
};

type UserProfileWrite = Partial<Omit<UserProfile, "uid" | "updatedAt">> & {
  email: string;
};

type CreateSessionInput = Omit<
  StudySession,
  "createdAt" | "participantIds" | "sessionId" | "status" | "updatedAt"
> & {
  participantIds?: string[];
  status?: StudySessionStatus;
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
  profile: UserProfileWrite
) {
  const userRef = doc(db, COLLECTIONS.users, userId);
  const existingUser = await getDoc(userRef);

  await setDoc(
    userRef,
    {
      uid: userId,
      email: profile.email,
      displayName: profile.displayName ?? "",
      photoURL: profile.photoURL ?? "",
      classes: profile.classes ?? existingUser.data()?.classes ?? [],
      availability: profile.availability ?? existingUser.data()?.availability ?? [],
      socials: profile.socials ?? existingUser.data()?.socials ?? {
        phone: "",
        instagram: "",
        snapchat: "",
        discord: "",
      },
      createdAt:
        existingUser.data()?.createdAt ??
        profile.createdAt ??
        serverTimestamp(),
      lastLoginAt: profile.lastLoginAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getUserProfile(userId: string) {
  const snapshot = await getDoc(doc(db, COLLECTIONS.users, userId));

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as UserProfile;
}

function isSameAvailabilitySlot(first: AvailabilitySlot, second: AvailabilitySlot) {
  const firstDay = first.date ? getAvailabilityDayFromDate(first.date) : first.day;
  const secondDay = second.date ? getAvailabilityDayFromDate(second.date) : second.day;

  return (
    (first.date && second.date ? first.date === second.date : firstDay === secondDay) &&
    first.startMinutes === second.startMinutes &&
    first.endMinutes === second.endMinutes
  );
}

function getAvailabilityDayFromDate(date: string): AvailabilityDay {
  const parsedDate = new Date(`${date}T12:00:00`);
  const day = parsedDate.getDay();

  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"][day] ?? "mon") as AvailabilityDay;
}

function getAvailabilityOverlap(
  currentAvailability: AvailabilitySlot[],
  candidateAvailability: AvailabilitySlot[]
) {
  return currentAvailability.filter((currentSlot) =>
    candidateAvailability.some((candidateSlot) => isSameAvailabilitySlot(currentSlot, candidateSlot))
  );
}

export async function getPotentialMatches(currentUserId: string) {
  const currentUser = await getUserProfile(currentUserId);
  const blockedUserIds = await getBlockedUserIds(currentUserId);

  if (!currentUser) {
    return [];
  }

  const usersSnapshot = await getDocs(collection(db, COLLECTIONS.users));

  return usersSnapshot.docs
    .map((userDoc) => userDoc.data() as UserProfile)
    .filter((candidateUser) => candidateUser.uid !== currentUserId)
    .filter((candidateUser) => !blockedUserIds.includes(candidateUser.uid))
    .map((candidateUser) => {
      const sharedClasses = candidateUser.classes.filter((classCode) =>
        currentUser.classes.includes(classCode)
      );
      const availabilityOverlap = getAvailabilityOverlap(
        currentUser.availability,
        candidateUser.availability
      );

      return {
        availabilityOverlap,
        sharedClasses,
        user: candidateUser,
      };
    })
    .filter(
      (match) => match.sharedClasses.length > 0 && match.availabilityOverlap.length > 0
    )
    .sort((firstMatch, secondMatch) => {
      if (secondMatch.sharedClasses.length !== firstMatch.sharedClasses.length) {
        return secondMatch.sharedClasses.length - firstMatch.sharedClasses.length;
      }

      return secondMatch.availabilityOverlap.length - firstMatch.availabilityOverlap.length;
    });
}

export async function getPotentialMatch(currentUserId: string, matchUserId: string) {
  const matches = await getPotentialMatches(currentUserId);

  return matches.find((match) => match.user.uid === matchUserId) ?? null;
}

export async function updateUserClasses(userId: string, classes: string[]) {
  await updateDoc(doc(db, COLLECTIONS.users, userId), {
    classes,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserAvailability(
  userId: string,
  availability: AvailabilitySlot[]
) {
  await updateDoc(doc(db, COLLECTIONS.users, userId), {
    availability,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserDisplayName(userId: string, displayName: string) {
  await updateDoc(doc(db, COLLECTIONS.users, userId), {
    displayName,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserSocials(userId: string, socials: Socials) {
  await updateDoc(doc(db, COLLECTIONS.users, userId), {
    socials,
    updatedAt: serverTimestamp(),
  });
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

export async function getSessions() {
  const sessionsQuery = query(
    collection(db, COLLECTIONS.sessions),
    orderBy("createdAt", "desc")
  );
  const [sessionsSnapshot, locations] = await Promise.all([
    getDocs(sessionsQuery),
    getLocations(),
  ]);

  const locationsById = new Map(
    locations.map((location) => [location.locationId, location] as const)
  );

  const sessionDocs = sessionsSnapshot.docs.map((sessionDoc) => ({
    sessionId: sessionDoc.id,
    ...(sessionDoc.data() as Omit<StudySession, "sessionId">),
  }));

  const hostIds = [...new Set(sessionDocs.map((session) => session.hostId))];
  const hostProfiles = await Promise.all(hostIds.map((hostId) => getUserProfile(hostId)));
  const hostsById = new Map(
    hostIds.map((hostId, index) => [hostId, hostProfiles[index]] as const)
  );

  const participantIds = [
    ...new Set(sessionDocs.flatMap((session) => session.participantIds)),
  ];
  const participantProfiles = await Promise.all(
    participantIds.map((participantId) => getUserProfile(participantId))
  );
  const participantsById = new Map(
    participantIds.map((participantId, index) => [participantId, participantProfiles[index]] as const)
  );

  return sessionDocs.map((session) => ({
    ...session,
    attendeeProfiles: session.participantIds
      .map((participantId) => participantsById.get(participantId))
      .filter((participant): participant is UserProfile => !!participant),
    hostEmail: hostsById.get(session.hostId)?.email ?? '',
    hostProfile: hostsById.get(session.hostId) ?? null,
    location: locationsById.get(session.locationId) ?? findStudyLocationById(session.locationId),
  }));
}

export async function getSessionsForClassIds(classIds: string[]) {
  const normalizedClassIds = classIds
    .map((classId) => classId.trim().toUpperCase())
    .filter(Boolean);

  if (normalizedClassIds.length === 0) {
    return [];
  }

  const allSessions = await getSessions();

  return allSessions.filter((session) =>
    normalizedClassIds.includes(session.classId.trim().toUpperCase())
  );
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

  const [location, hostProfile, attendeeProfiles] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.locations, session.locationId)),
    getUserProfile(session.hostId),
    Promise.all(session.participantIds.map((participantId) => getUserProfile(participantId))),
  ]);

  return {
    ...session,
    attendeeProfiles: attendeeProfiles.filter((participant): participant is UserProfile => !!participant),
    hostEmail: hostProfile?.email ?? '',
    hostProfile,
    location: location.exists()
      ? ({
          locationId: location.id,
          ...(location.data() as Omit<StudyLocation, "locationId">),
        } satisfies StudyLocation)
      : findStudyLocationById(session.locationId),
  } satisfies StudySessionListItem;
}

export async function joinSession(sessionId: string, userId: string) {
  await updateDoc(doc(db, COLLECTIONS.sessions, sessionId), {
    participantIds: arrayUnion(userId),
    updatedAt: serverTimestamp(),
  });
}

export async function createSession(input: CreateSessionInput) {
  const startDate = new Date(input.startTime);
  const endDate = new Date(input.endTime);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Session start and end times must be valid ISO timestamps.");
  }

  const scheduleDate = [
    startDate.getFullYear(),
    `${startDate.getMonth() + 1}`.padStart(2, "0"),
    `${startDate.getDate()}`.padStart(2, "0"),
  ].join("-");
  const scheduleStart = [
    `${startDate.getHours()}`.padStart(2, "0"),
    `${startDate.getMinutes()}`.padStart(2, "0"),
  ].join(":");
  const scheduleEnd = [
    `${endDate.getHours()}`.padStart(2, "0"),
    `${endDate.getMinutes()}`.padStart(2, "0"),
  ].join(":");
  const validatedSchedule = validateSessionSchedule(
    scheduleDate,
    scheduleStart,
    scheduleEnd
  );

  if ("error" in validatedSchedule) {
    throw new Error(validatedSchedule.error);
  }

  const sessionRef = await addDoc(collection(db, COLLECTIONS.sessions), {
    classId: input.classId,
    hostId: input.hostId,
    locationId: input.locationId,
    title: input.title,
    startTime: validatedSchedule.startTimeIso,
    endTime: validatedSchedule.endTimeIso,
    participantIds: input.participantIds ?? [input.hostId],
    status: input.status ?? "open",
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

    const otherUserIds = [
      ...new Set(
        rawConversations.flatMap((conversation) =>
          conversation.participantIds.filter((participantId) => participantId !== userId)
        )
      ),
    ];
    const profiles = await Promise.all(otherUserIds.map((participantId) => getUserProfile(participantId)));
    const profilesById = new Map(
      otherUserIds.map((participantId, index) => [participantId, profiles[index]] as const)
    );

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
    details: details.trim(),
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
  const ratingRef = doc(db, COLLECTIONS.locationRatings, `${locationId}__${userId}`);
  const existing = await getDoc(ratingRef);

  await setDoc(ratingRef, {
    locationId,
    userId,
    stars,
    tags,
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

  return snapshot.data() as LocationRating;
}

export async function getLocationRatingAggregates() {
  const snapshot = await getDocs(collection(db, COLLECTIONS.locationRatings));
  const ratings = snapshot.docs.map((ratingDoc) => ratingDoc.data() as LocationRating);

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
      for (const tag of rating.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    const topTags = [...tagCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag]) => tag);

    aggregates.set(locationId, {
      averageStars: Math.round(averageStars * 10) / 10,
      locationId,
      topTags,
      totalRatings,
    });
  }

  return aggregates;
}
