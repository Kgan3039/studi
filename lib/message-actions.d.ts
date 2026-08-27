export const MESSAGE_EDIT_WINDOW_MS: number;
export const MESSAGE_DOUBLE_TAP_WINDOW_MS: number;
export const MESSAGE_UNSEND_WINDOW_MS: number;

export type MessageActionRecord = {
  createdAt?: unknown;
  editedAt?: unknown;
  likedByIds?: string[];
  messageId: string;
  originalText?: string;
  pending?: boolean;
  replyTo?: {
    messageId: string;
    senderId: string;
    text: string;
  };
  senderId: string;
  text: string;
  unsentAt?: unknown;
};

export function timestampToMillis(value: unknown): number;
export function isMessageUnsent(message?: Partial<MessageActionRecord> | null): boolean;
export function isMessageDoubleTap(previousTapMs: number, currentTapMs: number): boolean;
export function normalizeMessageLikedByIds(value: unknown): string[];
export function canEditMessage(
  message: Partial<MessageActionRecord> | null | undefined,
  userId: string | null | undefined,
  nowMs?: number
): boolean;
export function canUnsendMessage(
  message: Partial<MessageActionRecord> | null | undefined,
  userId: string | null | undefined,
  nowMs?: number
): boolean;
export function hasMessageTextChanged(currentText: unknown, nextText: unknown): boolean;
export function hiddenMessageHydrationState(
  scopeKey: string | null | undefined,
  hydratedScopeKey: string | null | undefined,
  failedScopeKey: string | null | undefined
): { error: boolean; ready: boolean };
export function toggleSelectedMessageId(
  selectedMessageIds: Iterable<string>,
  messageId: string
): Set<string>;
export function buildSelectedMessageCopy(
  messages: MessageActionRecord[],
  selectedMessageIds: Iterable<string>
): string;
