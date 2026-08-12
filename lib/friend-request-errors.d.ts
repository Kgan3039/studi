export declare const FRIEND_REQUEST_ERROR_TITLE: string;
export declare const FRIEND_REQUEST_ERROR_COPY: Readonly<{
  cooldown: string;
  relationship: string;
  network: string;
  auth: string;
  generic: string;
}>;

export declare class FriendRequestCooldownError extends Error {
  readonly code: 'friend-request/cooldown';
}

export declare class FriendRequestAuthError extends Error {
  readonly code: 'friend-request/auth';
}

export declare function mapFriendRequestError(error: unknown): string;
export declare function showFriendRequestFailure(input: {
  error: unknown;
  platform: string;
  showNativeAlert: (title: string, message: string) => void | Promise<void>;
  showWebAlert: (message: string) => void | Promise<void>;
}): Promise<string>;
