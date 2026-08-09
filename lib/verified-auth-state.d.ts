export type AuthVerificationState = 'pending' | 'unverified' | 'verified';

export type VerifiedAuthUser = {
  uid: string;
  emailVerified: boolean;
  getIdToken(forceRefresh?: boolean): Promise<string>;
  getIdTokenResult(): Promise<{ claims: Record<string, unknown> }>;
};

export declare function createVerifiedAuthStateSubscriber<TUser extends VerifiedAuthUser>(options: {
  subscribeToAuthState(listener: (user: TUser | null) => void): () => void;
  getCurrentUser(): TUser | null;
}): (
  listener: (user: TUser | null, state: AuthVerificationState) => void
) => () => void;

export type RootAuthState = 'checking' | 'signed-out' | 'unverified' | 'signed-in';

export declare function getRootAuthAccess(options: {
  authRestored: boolean;
  authState: RootAuthState;
}): {
  mountNavigator: boolean;
  allowProtectedRoutes: boolean;
};
