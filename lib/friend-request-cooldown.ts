import { useEffect, useState } from 'react';

export const FRIEND_REQUEST_COOLDOWN_SECONDS = 10;

let cooldownEndsAt = 0;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function startFriendRequestCooldown(now = Date.now()) {
  cooldownEndsAt = now + FRIEND_REQUEST_COOLDOWN_SECONDS * 1000;
  notifyListeners();
}

export function getFriendRequestCooldownSeconds(now = Date.now()) {
  return Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000));
}

/** Keeps every mounted friend-request confirmation in sync with the global limit. */
export function useFriendRequestCooldown() {
  const [seconds, setSeconds] = useState(() => getFriendRequestCooldownSeconds());

  useEffect(() => {
    const update = () => setSeconds(getFriendRequestCooldownSeconds());
    listeners.add(update);
    update();
    const timer = setInterval(update, 250);
    return () => {
      listeners.delete(update);
      clearInterval(timer);
    };
  }, []);

  return seconds;
}
