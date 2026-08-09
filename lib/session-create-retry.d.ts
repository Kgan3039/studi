export type SessionRetryUser = {
  uid: string;
  emailVerified: boolean;
  getIdToken(forceRefresh?: boolean): Promise<string>;
  getIdTokenResult(): Promise<{ claims: Record<string, unknown> }>;
};

export declare class CreateSessionValidationError extends Error {}

export declare const SAFE_CREATE_SESSION_ERROR: string;

export declare function createWithStaleVerificationRetry<TResult>(options: {
  attempt(): Promise<TResult>;
  expectedUid: string;
  getCurrentUser(): SessionRetryUser | null;
  isPermissionDenied(error: unknown): boolean;
}): Promise<TResult>;

export declare function getCreateSessionErrorMessage(error: unknown): string;
