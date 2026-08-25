import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { ObjectionableContentError } from '@/lib/content-moderation';
import {
  editChatMessage,
  hideChatMessagesForUser,
  setChatMessageLiked,
  subscribeToHiddenMessageIds,
  unsendChatMessage,
  type ChatThreadType,
} from '@/lib/firestore';
import {
  buildSelectedMessageCopy,
  canEditMessage,
  canUnsendMessage,
  hasMessageTextChanged,
  hiddenMessageHydrationState,
  isMessageUnsent,
  toggleSelectedMessageId,
  type MessageActionRecord,
} from '@/lib/message-actions';

type UseMessageActionsOptions = {
  allowEditing?: boolean;
  allowReactions?: boolean;
  allowUnsend?: boolean;
  currentUserId?: string;
  messages: MessageActionRecord[];
  onReportMessage?: (message: MessageActionRecord) => void;
  onSuccess?: (headline: string, body?: string) => void;
  threadId?: string;
  threadType: ChatThreadType;
};

function actionErrorMessage(error: unknown, action: 'delete' | 'edit' | 'unsend') {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  if (code.includes('unavailable') || code.includes('network-request-failed')) {
    return 'Check your connection and try again.';
  }
  if (action === 'edit' && code.includes('permission-denied')) {
    return 'This message can no longer be edited. Edits are available for 15 minutes.';
  }
  if (action === 'unsend' && code.includes('permission-denied')) {
    return 'This message can no longer be unsent. Unsend is available for 2 minutes.';
  }
  if (action === 'delete') {
    return "We couldn't delete that message for you. Please try again.";
  }
  return action === 'edit'
    ? "We couldn't edit that message. Please try again."
    : "We couldn't unsend that message. Please try again.";
}

export function useMessageActions({
  allowEditing = true,
  allowReactions = true,
  allowUnsend = true,
  currentUserId,
  messages,
  onReportMessage,
  onSuccess,
  threadId,
  threadType,
}: UseMessageActionsOptions) {
  const hiddenMessagesScopeKey = currentUserId && threadId
    ? `${currentUserId}:${threadType}:${threadId}`
    : null;
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());
  const [hydratedHiddenMessagesScopeKey, setHydratedHiddenMessagesScopeKey] =
    useState<string | null>(null);
  const [failedHiddenMessagesScopeKey, setFailedHiddenMessagesScopeKey] =
    useState<string | null>(null);
  const [hiddenMessagesRetryNonce, setHiddenMessagesRetryNonce] = useState(0);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [originalMessageId, setOriginalMessageId] = useState<string | null>(null);
  const [reactionMessageId, setReactionMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmUnsendMessageId, setConfirmUnsendMessageId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    fromSelection: boolean;
    messageIds: string[];
  } | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [actionNowMs, setActionNowMs] = useState(Date.now());
  const likeWriteIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setHiddenMessageIds(new Set());
    setHydratedHiddenMessagesScopeKey(null);
    setFailedHiddenMessagesScopeKey(null);
    setActiveMessageId(null);
    setEditingMessageId(null);
    setOriginalMessageId(null);
    setReactionMessageId(null);
    setEditDraft('');
    setConfirmUnsendMessageId(null);
    setPendingDelete(null);
    setSelectedMessageIds(new Set());
    setIsSelecting(false);
    likeWriteIdsRef.current.clear();
    if (!currentUserId || !threadId || !hiddenMessagesScopeKey) {
      return;
    }

    return subscribeToHiddenMessageIds(
      currentUserId,
      threadType,
      threadId,
      (messageIds) => {
        setHiddenMessageIds(messageIds);
        setFailedHiddenMessagesScopeKey(null);
        setHydratedHiddenMessagesScopeKey(hiddenMessagesScopeKey);
      },
      () => {
        // Fail closed: without an authoritative marker snapshot, rendering the
        // shared messages could flash content this user deleted for themselves.
        setFailedHiddenMessagesScopeKey(hiddenMessagesScopeKey);
        setHydratedHiddenMessagesScopeKey(null);
      }
    );
  }, [
    currentUserId,
    hiddenMessagesRetryNonce,
    hiddenMessagesScopeKey,
    threadId,
    threadType,
  ]);

  const {
    error: hiddenMessagesError,
    ready: hiddenMessagesReady,
  } = hiddenMessageHydrationState(
    hiddenMessagesScopeKey,
    hydratedHiddenMessagesScopeKey,
    failedHiddenMessagesScopeKey
  );

  function retryHiddenMessages() {
    setFailedHiddenMessagesScopeKey(null);
    setHydratedHiddenMessagesScopeKey(null);
    setHiddenMessagesRetryNonce((nonce) => nonce + 1);
  }

  useEffect(() => {
    if (!activeMessageId) {
      return;
    }
    setActionNowMs(Date.now());
    const timer = setInterval(() => setActionNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [activeMessageId]);

  useEffect(() => {
    if (activeMessageId && hiddenMessageIds.has(activeMessageId)) {
      setActiveMessageId(null);
    }
    if (editingMessageId && hiddenMessageIds.has(editingMessageId)) {
      setEditingMessageId(null);
      setEditDraft('');
    }
    if (originalMessageId && hiddenMessageIds.has(originalMessageId)) {
      setOriginalMessageId(null);
    }
    if (reactionMessageId && hiddenMessageIds.has(reactionMessageId)) {
      setReactionMessageId(null);
    }
    setSelectedMessageIds((current) => {
      const next = new Set([...current].filter((messageId) => !hiddenMessageIds.has(messageId)));
      return next.size === current.size ? current : next;
    });
  }, [activeMessageId, editingMessageId, hiddenMessageIds, originalMessageId, reactionMessageId]);

  const findMessage = (messageId: string | null) =>
    messageId ? messages.find((message) => message.messageId === messageId) ?? null : null;
  const activeMessage = findMessage(activeMessageId);
  const editingMessage = findMessage(editingMessageId);
  const originalMessage = findMessage(originalMessageId);
  const reactionMessage = findMessage(reactionMessageId);
  const unsendMessage = findMessage(confirmUnsendMessageId);

  useEffect(() => {
    if (
      reactionMessageId
      && (!reactionMessage || isMessageUnsent(reactionMessage) || !reactionMessage.likedByIds?.length)
    ) {
      setReactionMessageId(null);
    }
  }, [reactionMessage, reactionMessageId]);

  const selectedMessages = messages.filter((message) => selectedMessageIds.has(message.messageId));
  const selectedCopy = buildSelectedMessageCopy(selectedMessages, selectedMessageIds);
  const canCopyActive = !!activeMessage && !isMessageUnsent(activeMessage) && !!activeMessage.text;
  const canEditActive =
    allowEditing && canEditMessage(activeMessage, currentUserId, actionNowMs);
  const canUnsendActive =
    allowUnsend && canUnsendMessage(activeMessage, currentUserId, actionNowMs);
  const canReportActive =
    !!activeMessage
    && !!currentUserId
    && activeMessage.senderId !== currentUserId
    && !isMessageUnsent(activeMessage)
    && !!onReportMessage;
  const canConfirmEdit =
    !!editingMessage && hasMessageTextChanged(editingMessage.text, editDraft) && !isWorking;

  function openMessageActions(message: MessageActionRecord) {
    if (message.pending) {
      return;
    }
    setActionNowMs(Date.now());
    setActiveMessageId(message.messageId);
  }

  function closeMessageActions() {
    setActiveMessageId(null);
  }

  function reportActiveMessage() {
    if (!activeMessage || !canReportActive || !onReportMessage) {
      return;
    }
    const message = activeMessage;
    closeMessageActions();
    onReportMessage(message);
  }

  async function copyText(text: string, count?: number) {
    try {
      await Clipboard.setStringAsync(text);
      onSuccess?.(count && count > 1 ? `${count} messages copied` : 'Message copied');
    } catch {
      Alert.alert('Copy Failed', "We couldn't copy that message. Please try again.");
    }
  }

  async function copyActiveMessage() {
    if (!activeMessage || !canCopyActive) {
      return;
    }
    closeMessageActions();
    await copyText(activeMessage.text);
  }

  function beginEditingActiveMessage() {
    if (!activeMessage || !canEditActive) {
      return;
    }
    setEditDraft(activeMessage.text);
    setEditingMessageId(activeMessage.messageId);
    closeMessageActions();
  }

  function closeEditor() {
    if (isWorking) {
      return;
    }
    setEditingMessageId(null);
    setEditDraft('');
  }

  async function confirmEdit() {
    if (
      !currentUserId
      || !threadId
      || !editingMessage
      || !canConfirmEdit
      || isWorking
    ) {
      return;
    }

    try {
      setIsWorking(true);
      await editChatMessage(
        threadType,
        threadId,
        editingMessage.messageId,
        currentUserId,
        editDraft
      );
      setEditingMessageId(null);
      setEditDraft('');
      onSuccess?.('Message edited');
    } catch (error) {
      const body =
        error instanceof ObjectionableContentError
          ? error.message
          : actionErrorMessage(error, 'edit');
      Alert.alert('Edit Failed', body);
    } finally {
      setIsWorking(false);
    }
  }

  function requestUnsendActiveMessage() {
    if (!activeMessage || !canUnsendActive) {
      return;
    }
    setConfirmUnsendMessageId(activeMessage.messageId);
    closeMessageActions();
  }

  async function confirmUnsend() {
    if (!currentUserId || !threadId || !unsendMessage || isWorking) {
      return;
    }

    try {
      setIsWorking(true);
      await unsendChatMessage(
        threadType,
        threadId,
        unsendMessage.messageId,
        currentUserId
      );
      setConfirmUnsendMessageId(null);
      onSuccess?.('Message unsent');
    } catch (error) {
      Alert.alert(
        'Unsend Failed',
        actionErrorMessage(error, 'unsend')
      );
    } finally {
      setIsWorking(false);
    }
  }

  function requestDeleteActiveMessage() {
    if (!activeMessage) {
      return;
    }
    setPendingDelete({ fromSelection: false, messageIds: [activeMessage.messageId] });
    closeMessageActions();
  }

  function beginSelectingActiveMessage() {
    if (!activeMessage) {
      return;
    }
    setSelectedMessageIds(new Set([activeMessage.messageId]));
    setIsSelecting(true);
    closeMessageActions();
  }

  function toggleMessageSelection(messageId: string) {
    setSelectedMessageIds((current) => toggleSelectedMessageId(current, messageId));
  }

  function finishSelecting() {
    setIsSelecting(false);
    setSelectedMessageIds(new Set());
  }

  async function copySelectedMessages() {
    if (!selectedCopy) {
      return;
    }
    await copyText(
      selectedCopy,
      selectedMessages.filter((message) => !isMessageUnsent(message)).length
    );
  }

  function requestDeleteSelectedMessages() {
    if (selectedMessageIds.size === 0) {
      return;
    }
    setPendingDelete({ fromSelection: true, messageIds: [...selectedMessageIds] });
  }

  async function confirmDeleteForSelf() {
    if (!currentUserId || !threadId || !pendingDelete || isWorking) {
      return;
    }

    const { fromSelection, messageIds } = pendingDelete;
    try {
      setIsWorking(true);
      await hideChatMessagesForUser(
        currentUserId,
        threadType,
        threadId,
        messageIds
      );
      setHiddenMessageIds((current) => new Set([...current, ...messageIds]));
      setPendingDelete(null);
      if (fromSelection) {
        finishSelecting();
      }
      onSuccess?.(
        messageIds.length > 1 ? `${messageIds.length} messages deleted` : 'Message deleted',
        'Only for you.'
      );
    } catch (error) {
      Alert.alert('Delete Failed', actionErrorMessage(error, 'delete'));
    } finally {
      setIsWorking(false);
    }
  }

  function showOriginalMessage(message: MessageActionRecord) {
    if (message.originalText && message.editedAt && !message.unsentAt) {
      setOriginalMessageId(message.messageId);
    }
  }

  function showMessageLikes(message: MessageActionRecord) {
    if (!isMessageUnsent(message) && (message.likedByIds?.length ?? 0) > 0) {
      setReactionMessageId(message.messageId);
    }
  }

  function closeMessageLikes() {
    setReactionMessageId(null);
  }

  function canReactToMessage(message: MessageActionRecord) {
    return (
      allowReactions
      && !!currentUserId
      && !!threadId
      && !message.pending
      && !isMessageUnsent(message)
    );
  }

  async function toggleMessageLike(message: MessageActionRecord) {
    if (
      !currentUserId
      || !threadId
      || !canReactToMessage(message)
      || likeWriteIdsRef.current.has(message.messageId)
    ) {
      return;
    }

    const shouldLike = !message.likedByIds?.includes(currentUserId);
    likeWriteIdsRef.current.add(message.messageId);
    try {
      await setChatMessageLiked(
        threadType,
        threadId,
        message.messageId,
        currentUserId,
        shouldLike
      );
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : '';
      Alert.alert(
        'Reaction Failed',
        code.includes('unavailable') || code.includes('network-request-failed')
          ? 'Check your connection and try again.'
          : code.includes('permission-denied')
            ? 'This message cannot be liked right now. The chat may be read-only.'
            : "We couldn't update that reaction. Please try again."
      );
    } finally {
      likeWriteIdsRef.current.delete(message.messageId);
    }
  }

  return {
    activeMessage,
    beginEditingActiveMessage,
    beginSelectingActiveMessage,
    canReactToMessage,
    canConfirmEdit,
    canCopyActive,
    canEditActive,
    canReportActive,
    canUnsendActive,
    closeEditor,
    closeMessageLikes,
    closeMessageActions,
    confirmDeleteForSelf,
    confirmEdit,
    confirmUnsend,
    copyActiveMessage,
    copySelectedMessages,
    currentUserId,
    editDraft,
    editingMessage,
    finishSelecting,
    hiddenMessageIds,
    hiddenMessagesError,
    hiddenMessagesReady,
    isSelecting,
    isWorking,
    openMessageActions,
    originalMessage,
    pendingDelete,
    reactionMessage,
    reportActiveMessage,
    requestDeleteActiveMessage,
    requestDeleteSelectedMessages,
    requestUnsendActiveMessage,
    retryHiddenMessages,
    selectedCopy,
    selectedMessageIds,
    setConfirmUnsendMessageId,
    setEditDraft,
    setOriginalMessageId,
    setPendingDelete,
    showOriginalMessage,
    showMessageLikes,
    toggleMessageLike,
    toggleMessageSelection,
    threadType,
    unsendMessage,
  };
}

export type MessageActionController = ReturnType<typeof useMessageActions>;
