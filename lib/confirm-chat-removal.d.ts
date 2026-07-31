export const REMOVE_CHAT_MESSAGE: string;
export const REMOVE_CHAT_TITLE: string;
export const REMOVE_CHAT_FAILURE_MESSAGE: string;
export const REMOVE_CHAT_FAILURE_TITLE: string;

type NativeAlertButton = {
  text: string;
  style: "cancel" | "destructive";
  onPress?: () => void;
};

export function confirmChatRemoval(options: {
  platform: string;
  showNativeAlert: (
    title: string,
    message: string,
    buttons: NativeAlertButton[]
  ) => void;
  showWebConfirm: (message: string) => boolean;
  onConfirm: () => void;
}): void;

export function showChatRemovalFailure(options: {
  platform: string;
  showNativeAlert: (title: string, message: string) => void | Promise<unknown>;
  showWebAlert: (message: string) => void | Promise<unknown>;
}): Promise<void>;
