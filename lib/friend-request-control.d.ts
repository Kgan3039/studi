export declare const FRIEND_REQUEST_COOLDOWN_SECONDS: number;
export declare const FRIEND_REQUEST_COOLDOWN_MS: number;

export type FriendRequestSendResult = { status: 'sent' | 'cooldown' | 'ignored' };

export declare function getFriendRequestCooldownSeconds(userId: string, now?: number): number;
export declare function startFriendRequestCooldown(userId: string, now?: number): void;
export declare function subscribeToFriendRequestCooldown(
  userId: string,
  listener: () => void
): () => void;
export declare function isFriendRequestSendInFlight(userId: string): boolean;
export declare function canAttemptFriendRequest(userId: string, now?: number): boolean;
export declare function runFriendRequestSend(input: {
  userId: string;
  send: () => void | Promise<void>;
  now?: () => number;
}): Promise<FriendRequestSendResult>;

/** Test-only. Production sends release their claim in finally. */
export declare function __resetFriendRequestControlForTests(): void;
