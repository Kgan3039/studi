import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { ObjectionableContentError } from '@/lib/content-moderation';
import {
  editChatMessage,
  hideChatMessagesForUser,
  subscribeToHiddenMessageIds,
  unsendChatMessage,
  type ChatThreadType,
} from '@/lib/firestore';
import {
  buildSelectedMessageCopy,
  canEditMessage,
  canUnsendMessage,
  hasMessageTextChanged,
  isMessageUnsent,
  toggleSelectedMessageId,
  type MessageActionRecord,
} from '@/lib/message-actions';

type UseMessageActionsOptions = {
  allowEditing?: boolean;
  allowUnsend?: boolean;
  currentUserId?: string;
  messages: MessageActionRecord[];
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
  allowUnsend = true,
  currentUserId,
  messages,
  onSuccess,
  threadId,
  threadType,
}: UseMessageActionsOptions) {
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [originalMessageId, setOriginalMessageId] = useState<string | null>(null);
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

  useEffect(() => {
    setHiddenMessageIds(new Set());
    setActiveMessageId(null);
    setEditingMessageId(null);
    setOriginalMessageId(null);
    setEditDraft('');
    setConfirmUnsendMessageId(null);
    setPendingDelete(null);
    setSelectedMessageIds(new Set());
    setIsSelecting(false);
    if (!currentUserId || !threadId) {
      return;
    }

    return subscribeToHiddenMessageIds(
      currentUserId,
      threadType,
      threadId,
      setHiddenMessageIds,
      () => {
        // Keep the last known local-deletion state if its listener briefly fails.
      }
    );
  }, [currentUserId, threadId, threadType]);

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
    setSelectedMessageIds((current) => {
      const next = new Set([...current].filter((messageId) => !hiddenMessageIds.has(messageId)));
      return next.size === current.size ? current : next;
    });
  }, [activeMessageId, editingMessageId, hiddenMessageIds, originalMessageId]);

  const findMessage = (messageId: string | null) =>
    messageId ? messages.find((message) => message.messageId === messageId) ?? null : null;
  const activeMessage = findMessage(activeMessageId);
  const editingMessage = findMessage(editingMessageId);
  const originalMessage = findMessage(originalMessageId);
  const unsendMessage = findMessage(confirmUnsendMessageId);
  const selectedMessages = messages.filter((message) => selectedMessageIds.has(message.messageId));
  const selectedCopy = buildSelectedMessageCopy(selectedMessages, selectedMessageIds);
  const canCopyActive = !!activeMessage && !isMessageUnsent(activeMessage) && !!activeMessage.text;
  const canEditActive =
    allowEditing && canEditMessage(activeMessage, currentUserId, actionNowMs);
  const canUnsendActive =
    allowUnsend && canUnsendMessage(activeMessage, currentUserId, actionNowMs);
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

  return {
    activeMessage,
    beginEditingActiveMessage,
    beginSelectingActiveMessage,
    canConfirmEdit,
    canCopyActive,
    canEditActive,
    canUnsendActive,
    closeEditor,
    closeMessageActions,
    confirmDeleteForSelf,
    confirmEdit,
    confirmUnsend,
    copyActiveMessage,
    copySelectedMessages,
    editDraft,
    editingMessage,
    finishSelecting,
    hiddenMessageIds,
    isSelecting,
    isWorking,
    openMessageActions,
    originalMessage,
    pendingDelete,
    requestDeleteActiveMessage,
    requestDeleteSelectedMessages,
    requestUnsendActiveMessage,
    selectedCopy,
    selectedMessageIds,
    setConfirmUnsendMessageId,
    setEditDraft,
    setOriginalMessageId,
    setPendingDelete,
    showOriginalMessage,
    toggleMessageSelection,
    unsendMessage,
  };
}

export type MessageActionController = ReturnType<typeof useMessageActions>;
