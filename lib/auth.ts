import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onIdTokenChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type AuthError,
  type User,
} from "firebase/auth";

import { auth } from "../firebaseConfig";
import { identifyUser, resetAnalyticsIdentity, track } from "./analytics";
import { createOrUpdateUserProfile } from "./firestore";

const UW_EMAIL_DOMAIN = "@wisc.edu";

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

/**
 * Writes the Firestore profile for a signed-in, VERIFIED user.
 * Must only be called when `user.emailVerified === true` — Firestore rules
 * (PR 4) reject writes from unverified accounts.
 *
 * Display name precedence: explicit override > existing Firestore value
 * (preserved by merge semantics in createOrUpdateUserProfile) > Auth value.
 * This function intentionally does NOT pass the Auth displayName on plain
 * sign-ins, which previously clobbered Firestore-edited names.
 */
export async function syncUserProfile(user: User, displayNameOverride?: string) {
  await createOrUpdateUserProfile(user.uid, {
    email: user.email ?? "",
    ...(displayNameOverride ? { displayName: displayNameOverride } : {}),
  });
}

export async function signIn(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);

  if (!isValidUwEmail(normalizedEmail)) {
    throw new Error("Please use your @wisc.edu email.");
  }

  if (!password) {
    throw new Error("Enter your password.");
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);

    if (credential.user.emailVerified) {
      await syncUserProfile(credential.user);
    }

    return credential.user;
  } catch (error: unknown) {
    const authError = error as AuthError;

    if (
      authError.code === "auth/invalid-credential" ||
      authError.code === "auth/user-not-found" ||
      authError.code === "auth/wrong-password"
    ) {
      throw new Error(
        "Incorrect email or password. If you forgot your password, use “Forgot password?” below."
      );
    }

    if (authError.code === "auth/too-many-requests") {
      throw new Error("Too many attempts. Wait a few minutes or reset your password.");
    }

    throw authError;
  }
}

export async function signUp(
  email: string,
  password: string,
  firstName: string,
  lastName: string
) {
  const normalizedEmail = normalizeEmail(email);
  const displayName = buildDisplayName(firstName, lastName);

  if (!isValidUwEmail(normalizedEmail)) {
    throw new Error("Please use your @wisc.edu email.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  if (!normalizeNamePart(firstName) || !normalizeNamePart(lastName)) {
    throw new Error("Enter your first and last name.");
  }

  try {
    const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

    // Name lives on the Auth profile until the email is verified; the Firestore
    // profile is written post-verification (rules require a verified token).
    await updateProfile(credential.user, { displayName });
    await sendEmailVerification(credential.user);
    track("sign_up_completed");

    return credential.user;
  } catch (error: unknown) {
    const authError = error as AuthError;

    if (authError.code === "auth/email-already-in-use") {
      throw new Error(
        "An account with this email already exists. Sign in instead — or use “Forgot password?” if you can't get in."
      );
    }

    if (authError.code === "auth/weak-password") {
      throw new Error("Choose a stronger password (at least 8 characters).");
    }

    throw authError;
  }
}

export async function resendVerificationEmail() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Sign in first to resend the verification email.");
  }

  await sendEmailVerification(user);
}

/**
 * Reloads the current user and, on first confirmed verification, creates the
 * Firestore profile (carrying the name captured at sign-up). Returns the
 * fresh verification state.
 */
export async function refreshVerificationState() {
  const user = auth.currentUser;

  if (!user) {
    return { verified: false };
  }

  await user.reload();
  const freshUser = auth.currentUser;

  if (freshUser?.emailVerified) {
    // Force-refresh the ID token: Firestore rules read the email_verified
    // claim from the token, which stays stale for up to an hour after reload().
    await freshUser.getIdToken(true);
    await syncUserProfile(freshUser, freshUser.displayName ?? undefined);
    track("email_verified");
    identifyUser(freshUser.uid);
    return { verified: true };
  }

  return { verified: false };
}

export async function requestPasswordReset(email: string) {
  const normalizedEmail = normalizeEmail(email);

  if (!isValidUwEmail(normalizedEmail)) {
    throw new Error("Enter your @wisc.edu email to reset your password.");
  }

  try {
    await sendPasswordResetEmail(auth, normalizedEmail);
  } catch (error: unknown) {
    const authError = error as AuthError;

    // Don't reveal whether the account exists.
    if (authError.code !== "auth/user-not-found") {
      throw authError;
    }
  }
}

export function subscribeToAuthState(listener: (user: User | null) => void) {
  // Email verification changes the ID token without changing the user's UID.
  // onAuthStateChanged intentionally ignores that case, while
  // onIdTokenChanged updates the route gate as soon as verification is known.
  return onIdTokenChanged(auth, listener);
}

/**
 * Resolves once Firebase has finished restoring any persisted session.
 * Before this settles, onAuthStateChanged can emit null for a user who is
 * actually signed in (AsyncStorage restore is async) — route gates must not
 * treat that early null as signed-out.
 */
export function waitForAuthReady() {
  return auth.authStateReady();
}

export async function logOut() {
  await signOut(auth);
  resetAnalyticsIdentity();
}

// ---------------------------------------------------------------------------
// Account deletion (password reauth only — Apple branches removed; Apple
// sign-in was never implemented and its branch silently skipped reauth).
// Deletion runs through the deleteUserAccount Cloud Function (Admin SDK):
// one authoritative, transaction-paged path that also deletes the Auth user.
// ---------------------------------------------------------------------------

export type DeleteAccountResult =
  | { status: "deleted" }
  | { status: "requires-recent-login"; email: string };

type DeleteAccountOptions = {
  password?: string;
};

function isRecentLoginRequiredError(error: unknown) {
  const authError = error as AuthError;
  return (
    authError?.code === "auth/requires-recent-login" ||
    authError?.code === "functions/failed-precondition"
  );
}

async function reauthenticateForDelete(user: User, options: DeleteAccountOptions) {
  if (!user.email) {
    throw new Error("Unable to verify your account email for re-authentication.");
  }

  if (!options.password) {
    throw new Error("Please enter your password to confirm account deletion.");
  }

  const credential = EmailAuthProvider.credential(user.email, options.password);
  await reauthenticateWithCredential(user, credential);
  await user.getIdToken(true);
}

export async function deleteCurrentUserAccount(
  options: DeleteAccountOptions = {}
): Promise<DeleteAccountResult> {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("You must be signed in to delete your account.");
  }

  const email = currentUser.email ?? "";

  await reauthenticateForDelete(currentUser, options);

  try {
    const { getFunctions, httpsCallable } = await import("firebase/functions");
    const callDelete = httpsCallable(getFunctions(undefined, "us-central1"), "deleteUserAccount");
    await callDelete({});
    track("account_deleted");
    await signOut(auth); // the server already deleted the Auth user; clear local state
    resetAnalyticsIdentity();
    return { status: "deleted" };
  } catch (error) {
    if (isRecentLoginRequiredError(error)) {
      return { status: "requires-recent-login", email };
    }

    throw error;
  }
}
