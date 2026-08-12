import { Alert, Platform } from 'react-native';

import { showFriendRequestFailure } from '@/lib/friend-request-errors';

export function presentFriendRequestFailure(error: unknown) {
  void showFriendRequestFailure({
    error,
    platform: Platform.OS,
    showNativeAlert: (title, message) => Alert.alert(title, message),
    showWebAlert: (message) => {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(message);
      }
    },
  });
}
