import {
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
