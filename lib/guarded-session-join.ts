// The join entry point every UI surface calls instead of joinSession().
//
// This is a thin wiring layer: it binds the framework-free decision core in
// lib/session-block-warning.js to the real Firestore reads and to analytics,
// and it supplies the one fixed dialog the policy specifies. It deliberately
// owns nothing else — no toasts, no navigation, no loading state, no
// per-surface error copy. Each screen keeps its own post-join behavior and
// passes it in as `join`.
//
// Coverage gap, stated plainly: this file is the one part of the feature no
// test executes. The repo has no jest or react-test-renderer harness, so
// tests/session-block-warning.test.mjs drives the core through injected
// fetchers and separately scans the three surfaces to prove they route here,
// but nothing asserts that getSessionParticipantIds/getBlockedUserIds are the
// right reads or that Alert renders the request faithfully. Those two dozen
// lines are reviewed by reading, and are deliberately kept branch-free so
// there is nothing here to get subtly wrong. Standing up a RN renderer would
// close it and is its own change.

import { Alert } from 'react-native';

import { track } from '@/lib/analytics';
import { getBlockedUserIds, getSessionParticipantIds } from '@/lib/firestore';
import {
  BLOCKED_WARNING_VERIFICATION_ERROR,
  requestGuardedSessionJoin as guardJoin,
  type BlockedJoinConfirmRequest,
  type GuardedSessionJoinResult,
} from '@/lib/session-block-warning';

export { BLOCKED_WARNING_VERIFICATION_ERROR };
export type { GuardedSessionJoinResult };

/**
 * The standard two-button warning. Shared so the approved copy exists once;
 * surfaces pass it as `confirm` rather than each building their own Alert.
 */
export function confirmBlockedJoinWithAlert(request: BlockedJoinConfirmRequest) {
  Alert.alert(
    request.title,
    request.body,
    [
      { text: request.cancelLabel, style: 'cancel', onPress: request.onCancel },
      { text: request.confirmLabel, onPress: request.onConfirm },
    ],
    // Android can dismiss without a button press; treat that as Cancel so the
    // outcome is always recorded. The core ignores whichever answer is second.
    { cancelable: true, onDismiss: request.onCancel }
  );
}

/**
 * Runs the blocked-participant safety check, then hands off to the surface's
 * own join routine only if the join may proceed.
 *
 * Both reads happen here, at tap time, rather than being taken from screen
 * state: the roster must reflect anyone who joined since the screen loaded,
 * and a stale or failed block list must never be mistaken for "nobody blocked".
 */
export function requestGuardedSessionJoin(input: {
  sessionId: string;
  userId: string;
  /** Layered onto the warning events where the surface already has it. */
  classId?: string;
  confirm: (request: BlockedJoinConfirmRequest) => void;
  join: () => void | Promise<void>;
  onVerificationError: (message: string) => void;
}): Promise<GuardedSessionJoinResult> {
  return guardJoin({
    sessionId: input.sessionId,
    fetchParticipantIds: (sessionId) => getSessionParticipantIds(sessionId),
    // Outbound blocks only — getBlockedUserIds queries blockerUserId == me, so
    // a block pointing at the current user is never read and cannot leak.
    fetchBlockedUserIds: () => getBlockedUserIds(input.userId),
    confirm: input.confirm,
    join: input.join,
    onVerificationError: input.onVerificationError,
    track: (event, properties) =>
      track(event, input.classId ? { ...properties, classId: input.classId } : properties),
  });
}
