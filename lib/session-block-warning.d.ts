export declare const BLOCKED_WARNING_TITLE: string;
export declare const BLOCKED_WARNING_BODY: string;
export declare const BLOCKED_WARNING_CANCEL_LABEL: string;
export declare const BLOCKED_WARNING_CONFIRM_LABEL: string;
export declare const BLOCKED_WARNING_VERIFICATION_ERROR: string;

export type BlockedSessionWarningEvent =
  | 'blocked_session_warning_shown'
  | 'blocked_session_join_anyway'
  | 'blocked_session_cancel';

export type BlockedJoinConfirmRequest = {
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * - `joined` — join() ran (with or without a warning first)
 * - `cancelled` — the user declined the warning; join() never ran
 * - `verification-failed` — roster or block list unverifiable; join() never ran
 * - `ignored` — a guarded join for this session was already in flight
 */
export type GuardedSessionJoinStatus =
  | 'joined'
  | 'cancelled'
  | 'verification-failed'
  | 'ignored';

export type GuardedSessionJoinResult = {
  status: GuardedSessionJoinStatus;
  warned: boolean;
  blockedCount: number;
};

export declare function blockedParticipantIds(
  participantIds: readonly string[] | null | undefined,
  blockedUserIds: readonly string[] | null | undefined
): string[];

export declare function isGuardedJoinInFlight(sessionId: string): boolean;

/** Test-only; production paths release their own claim in a finally. */
export declare function __resetGuardedJoinsForTests(): void;

export declare function requestGuardedSessionJoin(input: {
  sessionId: string;
  /**
   * Authoritative roster, fetched at tap time. Returned raw and validated here:
   * anything that is not an array of non-empty strings — including one bad
   * element — fails closed. Throwing fails closed too.
   */
  fetchParticipantIds: (sessionId: string) => Promise<unknown>;
  /** Only blocks the current user made. Same all-or-nothing validation. */
  fetchBlockedUserIds: (sessionId: string) => Promise<unknown>;
  confirm: (request: BlockedJoinConfirmRequest) => void;
  join: () => void | Promise<void>;
  onVerificationError?: (message: string) => void;
  track?: (
    event: BlockedSessionWarningEvent,
    properties: { sessionId: string; blockedCount: number }
  ) => void;
}): Promise<GuardedSessionJoinResult>;
