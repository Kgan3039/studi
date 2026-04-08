import {
  arrayUnion,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "../firebaseConfig";

export const COLLECTIONS = {
  locations: "locations",
  sessions: "sessions",
  users: "users",
} as const;

export type AvailabilityDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type AvailabilitySlot = {
  day: AvailabilityDay;
  endMinutes: number;
  startMinutes: number;
};

export type UserProfile = {
  availability: AvailabilitySlot[];
  classes: string[];
  createdAt?: unknown;
  displayName: string;
  email: string;
  lastLoginAt?: unknown;
  photoURL: string;
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
  return (
    first.day === second.day &&
    first.startMinutes === second.startMinutes &&
    first.endMinutes === second.endMinutes
  );
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

  if (!currentUser) {
    return [];
  }

  const usersSnapshot = await getDocs(collection(db, COLLECTIONS.users));

  return usersSnapshot.docs
    .map((userDoc) => userDoc.data() as UserProfile)
    .filter((candidateUser) => candidateUser.uid !== currentUserId)
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

export async function getLocations() {
  const locationsQuery = query(
    collection(db, COLLECTIONS.locations),
    orderBy("name")
  );
  const snapshot = await getDocs(locationsQuery);

  return snapshot.docs.map((locationDoc) => ({
    locationId: locationDoc.id,
    ...(locationDoc.data() as Omit<StudyLocation, "locationId">),
  }));
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
    location: locationsById.get(session.locationId) ?? null,
  }));
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
      : null,
  } satisfies StudySessionListItem;
}

export async function joinSession(sessionId: string, userId: string) {
  await updateDoc(doc(db, COLLECTIONS.sessions, sessionId), {
    participantIds: arrayUnion(userId),
    updatedAt: serverTimestamp(),
  });
}

export async function createSession(input: CreateSessionInput) {
  const sessionRef = await addDoc(collection(db, COLLECTIONS.sessions), {
    classId: input.classId,
    hostId: input.hostId,
    locationId: input.locationId,
    title: input.title,
    startTime: input.startTime,
    endTime: input.endTime,
    participantIds: input.participantIds ?? [input.hostId],
    status: input.status ?? "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return sessionRef.id;
}
