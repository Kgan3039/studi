import {
  createUserWithEmailAndPassword,
  type AuthError,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";

import { auth } from "../firebaseConfig";
import { createOrUpdateUserProfile } from "./firestore";

const UW_EMAIL_DOMAIN = "@wisc.edu";
let pendingAccountCreation:
  | {
      email: string;
      password: string;
    }
  | null = null;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeNamePart(name: string) {
  return name.trim();
}

function buildDisplayName(firstName: string, lastName: string) {
  return `${normalizeNamePart(firstName)} ${normalizeNamePart(lastName)}`.trim();
}

export function isValidUwEmail(email: string) {
  return normalizeEmail(email).endsWith(UW_EMAIL_DOMAIN);
}

async function upsertUserProfile(user: User, displayNameOverride?: string) {
  await createOrUpdateUserProfile(user.uid, {
    email: user.email ?? "",
    displayName: displayNameOverride ?? user.displayName ?? "",
    photoURL: user.photoURL ?? "",
    createdAt:
      user.metadata.creationTime ??
      user.metadata.lastSignInTime ??
      new Date().toISOString(),
    lastLoginAt:
      user.metadata.lastSignInTime ??
      user.metadata.creationTime ??
      new Date().toISOString(),
  });
}

export async function signInOrPrepareAccountCreation(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);

  if (!isValidUwEmail(normalizedEmail)) {
    throw new Error("Please use your @wisc.edu email.");
  }

  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    await upsertUserProfile(credential.user);
    pendingAccountCreation = null;
    return { mode: "sign-in" as const, user: credential.user };
  } catch (error: unknown) {
    const authError = error as AuthError;

    if (
        authError.code !== "auth/invalid-credential" &&
        authError.code !== "auth/user-not-found"
    ) {
      throw authError;
    }
  }

  pendingAccountCreation = {
    email: normalizedEmail,
    password,
  };

  return { mode: "needs-profile" as const };
}

export function getPendingAccountCreationEmail() {
  return pendingAccountCreation?.email ?? "";
}

export function clearPendingAccountCreation() {
  pendingAccountCreation = null;
}

export async function completeAccountCreation(firstName: string, lastName: string) {
  const normalizedFirstName = normalizeNamePart(firstName);
  const normalizedLastName = normalizeNamePart(lastName);

  if (!normalizedFirstName || !normalizedLastName) {
    throw new Error("Enter your first and last name to create a new account.");
  }

  if (!pendingAccountCreation) {
    throw new Error("Start from the sign-in screen before creating a new account.");
  }

  const credential = await createUserWithEmailAndPassword(
    auth,
    pendingAccountCreation.email,
    pendingAccountCreation.password
  );
  const displayName = buildDisplayName(firstName, lastName);
  await updateProfile(credential.user, { displayName });
  await upsertUserProfile(credential.user, displayName);
  pendingAccountCreation = null;
  return { mode: "sign-up" as const, user: credential.user };
}

export function subscribeToAuthState(listener: (user: User | null) => void) {
  return onAuthStateChanged(auth, listener);
}

export async function logOut() {
  await signOut(auth);
}
