import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type AuthError,
  type User
} from "firebase/auth";

import { auth } from "../firebaseConfig";
import { createOrUpdateUserProfile, deleteUserAccountData } from "./firestore";

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

const RECENT_LOGIN_WINDOW_MS = 4 * 60 * 1000;

type DeleteAccountMethod = "password" | "apple" | "unknown";

export type DeleteAccountResult =
  | { status: "deleted" }
  | {
      status: "requires-recent-login";
      method: DeleteAccountMethod;
      email: string;
    };

type DeleteAccountOptions = {
  password?: string;
  appleAccessToken?: string;
  appleRefreshToken?: string;
};

function isRecentLoginRequiredError(error: unknown) {
  const authError = error as AuthError;
  return authError?.code === "auth/requires-recent-login";
}

function getDeleteAccountMethod(user: User): DeleteAccountMethod {
  const providerIds = user.providerData.map((provider) => provider.providerId);

  if (providerIds.includes("password")) {
    return "password";
  }

  if (providerIds.includes("apple.com")) {
    return "apple";
  }

  return "unknown";
}

function hasRecentLogin(user: User) {
  const lastSignInTime = user.metadata.lastSignInTime;

  if (!lastSignInTime) {
    return false;
  }

  const parsed = new Date(lastSignInTime).getTime();

  if (Number.isNaN(parsed)) {
    return false;
  }

  return Date.now() - parsed <= RECENT_LOGIN_WINDOW_MS;
}

async function revokeAppleAccessTokenWithRestApi(options: DeleteAccountOptions) {
  // Client-side Apple token revocation is intentionally not implemented here.
  // Apple revoke requires a server-side client secret, which should not be bundled
  // into the app. The delete flow still deletes the Firebase account itself.
  void options;
}

async function reauthenticateForDelete(user: User, method: DeleteAccountMethod, options: DeleteAccountOptions) {
  if (method === "password") {
    if (!user.email) {
      throw new Error("Unable to verify your account email for re-authentication.");
    }

    if (!options.password) {
      throw new Error("Please enter your password to confirm account deletion.");
    }

    const credential = EmailAuthProvider.credential(user.email, options.password);
    await reauthenticateWithCredential(user, credential);
    return;
  }

  if (method === "apple") {
    return;
  }

  throw new Error("Please sign in again before deleting your account.");
}

export async function deleteCurrentUserAccount(
  options: DeleteAccountOptions = {}
): Promise<DeleteAccountResult> {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("You must be signed in to delete your account.");
  }

  const method = getDeleteAccountMethod(currentUser);
  const email = currentUser.email ?? "";

  if (!hasRecentLogin(currentUser)) {
    if (!options.password && !options.appleAccessToken && !options.appleRefreshToken) {
      return {
        status: "requires-recent-login",
        method,
        email,
      };
    }

    await reauthenticateForDelete(currentUser, method, options);
  }

  const userId = currentUser.uid;

  try {
    // Client-side deletion path for the free Firebase plan.
    // Firestore rules must allow the owner to remove their own docs and the
    // related session/conversation/report data touched by the cleanup.
    await deleteUserAccountData(userId);
    await deleteUser(currentUser);
    return { status: "deleted" };
  } catch (error) {
    if (isRecentLoginRequiredError(error)) {
      return {
        status: "requires-recent-login",
        method,
        email,
      };
    }

    throw error;
  }
}

// `deleteCurrentUserAccount` performs client-side cleanup and deletes the Auth user.
// This is the no-Blaze path: Firestore rules must explicitly allow the owner-side
// deletes/updates needed by `deleteUserAccountData`.
