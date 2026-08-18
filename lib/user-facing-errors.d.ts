export type UserFacingErrorDomain =
  | 'accountDeletion'
  | 'auth'
  | 'classes'
  | 'conversation'
  | 'friend'
  | 'message'
  | 'passwordReset'
  | 'profile'
  | 'profileLoad'
  | 'rating'
  | 'report'
  | 'sessionJoin'
  | 'sessionLoad'
  | 'settings'
  | 'signOut'
  | 'spots'
  | 'verification'
  | 'verificationEmail';

export function getUserFacingErrorMessage(
  error: unknown,
  domain: UserFacingErrorDomain
): string;
