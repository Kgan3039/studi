import { useEffect, useState } from 'react';

import {
  getFriendRequestCooldownSeconds,
  subscribeToFriendRequestCooldown,
} from '@/lib/friend-request-control';

/** Keeps every mounted friend-request confirmation in sync with the global limit. */
export function useFriendRequestCooldown(userId?: string) {
  const [seconds, setSeconds] = useState(() =>
    userId ? getFriendRequestCooldownSeconds(userId) : 0
  );

  useEffect(() => {
    const update = () =>
      setSeconds(userId ? getFriendRequestCooldownSeconds(userId) : 0);
    const unsubscribe = userId
      ? subscribeToFriendRequestCooldown(userId, update)
      : () => {};
    update();
    const timer = setInterval(update, 250);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [userId]);

  return seconds;
}
