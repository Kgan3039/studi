import {
  createUserWithEmailAndPassword,
  type AuthError,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";

import { auth } from "../firebaseConfig";
import { createOrUpdateUserProfile } from "./firestore";

const UW_EMAIL_DOMAIN = "@wisc.edu";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidUwEmail(email: string) {
  return normalizeEmail(email).endsWith(UW_EMAIL_DOMAIN);
}

async function upsertUserProfile(user: User) {
  await createOrUpdateUserProfile(user.uid, {
    email: user.email ?? "",
    displayName: user.displayName ?? "",
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

export async function signInOrCreateAccount(email: string, password: string) {
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

  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  await upsertUserProfile(credential.user);
  return { mode: "sign-up" as const, user: credential.user };
}

export function subscribeToAuthState(listener: (user: User | null) => void) {
  return onAuthStateChanged(auth, listener);
}

export async function logOut() {
  await signOut(auth);
}
